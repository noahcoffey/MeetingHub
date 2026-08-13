"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type Node as FlowNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ProjectRelationKind, ProjectStatus } from "@/db/schema";
import {
  adjacencyOf,
  radialTree,
  type Point,
} from "../project-graph-layout";
import {
  ConnectBanner,
  GraphDefs,
  GraphLegend,
  edgeTypes,
  nodeTypes,
  useClickConnect,
  type ProjectEdgeData,
  type ProjectNodeData,
} from "../project-graph";
import { projectGraphState, todayLocal } from "../project-graph-state";
import {
  KIND_OPTION_LABEL,
  RELATION_KINDS,
  relationLabel,
} from "../relation-kinds";

export type MapNode = {
  id: string;
  name: string;
  status: ProjectStatus;
  deadline: string | null;
  hop: number;
};

export type MapEdge = {
  id: string;
  fromId: string;
  toId: string;
  kind: ProjectRelationKind;
  note: string | null;
  createdInMeetingId: string | null;
  createdInMeetingTitle: string | null;
};

// The preview's own coordinate space. React Flow's fitView scales whatever this
// produces into the card, so these are proportions rather than pixels.
const WIDTH = 760;
const HEIGHT = 520;
const TWEEN_MS = 380;

// Below this the canvas is replaced by the list further down: a pannable graph
// squeezed into a phone-width card is worse than a list, and React Flow in a
// zero-size container misbehaves — so it's unmounted, not just hidden.
const WIDE = "(min-width: 821px)";

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// Same radial tree as /map, rooted on the project whose hub this is. The server
// already limited the graph to `depth` hops, so the tree depth matches the hop
// count and a node's satellites sit with it rather than in a shared ring.
function layout(
  nodes: MapNode[],
  edges: MapEdge[],
  centreId: string,
): Map<string, Point> {
  if (nodes.length === 0) return new Map();
  const adj = adjacencyOf(nodes, edges);
  const ids = nodes.map((n) => n.id);
  const { points } = radialTree(centreId, ids, adj);
  const out = new Map<string, Point>();
  for (const [id, p] of points) {
    out.set(id, { x: WIDTH / 2 + p.x, y: HEIGHT / 2 + p.y });
  }
  // Anything the BFS didn't reach (shouldn't happen — the server only returns
  // the centre's component) still needs somewhere to be.
  let spare = 0;
  for (const n of nodes) {
    if (out.has(n.id)) continue;
    out.set(n.id, { x: 80 + spare * 170, y: HEIGHT - 40 });
    spare++;
  }
  return out;
}

export function ProjectMap(props: {
  centreId: string;
  initialNodes: MapNode[];
  initialEdges: MapEdge[];
  depth: 1 | 2;
  truncated: boolean;
}) {
  return (
    <ReactFlowProvider>
      <ProjectMapInner {...props} />
    </ReactFlowProvider>
  );
}

function ProjectMapInner({
  centreId,
  initialNodes,
  initialEdges,
  depth,
  truncated,
}: {
  centreId: string;
  initialNodes: MapNode[];
  initialEdges: MapEdge[];
  depth: 1 | 2;
  truncated: boolean;
}) {
  const router = useRouter();
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<ProjectRelationKind>("related");
  const [busy, setBusy] = useState(false);
  const [today] = useState(todayLocal);

  // Starts false so the server render and the first client render agree; the
  // effect below turns the canvas on where there's room for it.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const apply = () => setWide(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const targets = useMemo(
    () => layout(nodes, edges, centreId),
    [nodes, edges, centreId],
  );
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // Tween, like /map: adding a connected idea used to snap every bubble to a
  // new spot at once, which reads as the diagram reloading rather than growing.
  const [placed, setPlaced] = useState<Map<string, Point>>(targets);
  const placedRef = useRef(placed);
  const frameRef = useRef<number | null>(null);
  useEffect(() => {
    placedRef.current = placed;
  }, [placed]);
  useEffect(() => {
    const from = new Map(placedRef.current);
    const centre = { x: WIDTH / 2, y: HEIGHT / 2 };
    const start = performance.now();
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const k = easeInOutCubic(t);
      const next = new Map<string, Point>();
      for (const [id, to] of targets) {
        const a = from.get(id) ?? centre;
        next.set(id, { x: a.x + (to.x - a.x) * k, y: a.y + (to.y - a.y) * k });
      }
      setPlaced(next);
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [targets]);

  const fail = useCallback((message: string) => {
    setError(message);
    setTimeout(() => setError(null), 2500);
  }, []);

  // The hub map is a quick look, so a click leaves for that project's own hub
  // rather than re-centring in place — /map is where you stay and explore.
  const open = useCallback(
    (id: string) => {
      if (id === centreId) return;
      router.push(`/projects/${id}?tab=map`);
    },
    [centreId, router],
  );

  async function connect(fromId: string, toId: string) {
    try {
      const res = await fetch("/api/project-relations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromId, toId, kind: "related" }),
      });
      const data = (await res.json()) as { relation?: MapEdge; error?: string };
      if (!res.ok || !data.relation) {
        fail(data.error ?? "Could not connect those projects.");
        return;
      }
      setEdges((es) => [...es, data.relation as MapEdge]);
    } catch {
      fail("Could not connect those projects.");
    }
  }

  async function retype(edgeId: string, kind: ProjectRelationKind) {
    const prev = edges;
    setEdges((es) => es.map((e) => (e.id === edgeId ? { ...e, kind } : e)));
    try {
      const res = await fetch(`/api/project-relations/${edgeId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setEdges(prev);
        fail(data.error ?? "Could not change that connection.");
      }
    } catch {
      setEdges(prev);
      fail("Could not change that connection.");
    }
  }

  async function disconnect(edgeId: string) {
    const prev = edges;
    setEdges((es) => es.filter((e) => e.id !== edgeId));
    setSelectedEdge(null);
    try {
      const res = await fetch(`/api/project-relations/${edgeId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
    } catch {
      setEdges(prev);
      fail("Could not remove that connection.");
    }
  }

  async function addIdea(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/project-relations/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromProjectId: centreId, name, kind: newKind }),
      });
      const data = (await res.json()) as {
        project?: { id: string; name: string };
        relation?: MapEdge;
        error?: string;
      };
      if (!res.ok || !data.project || !data.relation) {
        fail(data.error ?? "Could not add that.");
        return;
      }
      setNodes((ns) => [
        ...ns,
        {
          id: data.project!.id,
          name: data.project!.name,
          status: "parked",
          deadline: null,
          hop: 1,
        },
      ]);
      setEdges((es) => [...es, data.relation as MapEdge]);
      setNewName("");
      setAdding(false);
    } catch {
      fail("Could not add that.");
    } finally {
      setBusy(false);
    }
  }

  async function promote(id: string) {
    const prev = nodes;
    setNodes((ns) =>
      ns.map((n) => (n.id === id ? { ...n, status: "active" } : n)),
    );
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setNodes(prev);
      fail("Could not promote that idea.");
    }
  }

  // ---- React Flow model ----
  const activateEdge = useCallback((id: string) => {
    setSelectedEdge((s) => (s === id ? null : id));
  }, []);

  const flowNodes = useMemo<FlowNode<ProjectNodeData>[]>(
    () =>
      nodes.flatMap((n) => {
        const p = placed.get(n.id);
        if (!p) return [];
        return [
          {
            id: n.id,
            type: "project" as const,
            position: p,
            data: {
              name: n.name,
              state: projectGraphState(n.status, n.deadline, today),
              // Open-task counts aren't in the hub payload; the tasks tab has them.
              badge: null,
              isCentre: n.id === centreId,
              isFaded: n.hop > 1,
              isSelected: false,
            },
          },
        ];
      }),
    [nodes, placed, centreId, today],
  );

  const flowEdges = useMemo<Edge<ProjectEdgeData>[]>(
    () =>
      edges.map((e) => ({
        id: e.id,
        type: "project",
        source: e.fromId,
        target: e.toId,
        selected: e.id === selectedEdge,
        data: {
          kind: e.kind,
          fromName: nodeById.get(e.fromId)?.name ?? "",
          toName: nodeById.get(e.toId)?.name ?? "",
          onActivate: activateEdge,
        },
      })),
    [edges, selectedEdge, nodeById, activateEdge],
  );

  // A finished click-to-connect also bubbles a click to the node underneath —
  // which here would navigate away from the project you were just wiring up.
  // A ref, not state: the click lands in the same event dispatch, so a state
  // update wouldn't be visible to the handler that has to skip.
  const justConnected = useRef(false);
  const clickConnect = useClickConnect();
  function onConnect(c: Connection) {
    if (!c.source || !c.target || c.source === c.target) return;
    justConnected.current = true;
    setTimeout(() => {
      justConnected.current = false;
    }, 0);
    void connect(c.source, c.target);
  }

  const selected = edges.find((e) => e.id === selectedEdge) ?? null;
  const parked = nodes.filter((n) => n.status === "parked");
  // The narrow-screen list: the centre's own edges.
  const listEdges = edges.filter(
    (e) => e.fromId === centreId || e.toId === centreId,
  );

  return (
    <div className="pmap">
      <GraphDefs />
      <div className="pmap-toolbar">
        <div className="range-toggle pmap-hops" role="group" aria-label="Map depth">
            <a
              className={`range-btn ${depth === 1 ? "is-active" : ""}`}
              href={`/projects/${centreId}?tab=map&depth=1`}
            >
              1 hop
            </a>
            <a
              className={`range-btn ${depth === 2 ? "is-active" : ""}`}
              href={`/projects/${centreId}?tab=map&depth=2`}
          >
            2 hops
          </a>
        </div>
        {adding ? (
          <form className="pmap-add-form" onSubmit={addIdea}>
            <select
              className="rel-kind-select"
              value={newKind}
              onChange={(e) =>
                setNewKind(e.target.value as ProjectRelationKind)
              }
              aria-label="How it relates"
            >
              {RELATION_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_OPTION_LABEL[k]}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name the idea…"
              autoFocus
              disabled={busy}
            />
            <button type="submit" className="primary-btn" disabled={busy}>
              {busy ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setAdding(false)}
              disabled={busy}
            >
              Cancel
            </button>
          </form>
        ) : (
          <button
            type="button"
            className="primary-btn"
            onClick={() => setAdding(true)}
          >
            + Connected idea
          </button>
        )}
      </div>

      {error && <p className="login-error pmap-error">{error}</p>}
      {clickConnect.armedFrom && (
        <ConnectBanner
          name={nodeById.get(clickConnect.armedFrom)?.name ?? "this project"}
          onCancel={clickConnect.cancel}
        />
      )}
      {truncated && (
        <p className="muted empty-sm">
          Showing the first {nodes.length} projects — this map is larger than
          what fits.
        </p>
      )}

      {nodes.length <= 1 && (
        <p className="ai-empty">
          Nothing connected yet. Add an idea, or capture one from a meeting&apos;s
          rail while it&apos;s being discussed.
        </p>
      )}

      {wide && (
        <div className="pmap-canvas">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            nodesDraggable={false}
            nodesConnectable
            // The custom edge puts role/tabIndex/Enter-Space on the path
            // itself, so React Flow's own edge focus would be a second,
            // duplicate tab stop on the wrapper.
            edgesFocusable={false}
            nodeOrigin={[0.5, 0.5]}
            fitView
            fitViewOptions={{ padding: 0.12 }}
            minZoom={0.3}
            maxZoom={1.6}
            zoomOnDoubleClick={false}
            onNodeClick={(_, n) => {
              if (justConnected.current) return;
              open(n.id);
            }}
            onEdgeClick={(_, e) => activateEdge(e.id)}
            onConnect={onConnect}
            onClickConnectStart={clickConnect.onClickConnectStart}
            onClickConnectEnd={clickConnect.onClickConnectEnd}
            onPaneClick={() => setSelectedEdge(null)}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}

      {selected && (
        <div className="pmap-edge-panel">
          <span className="pmap-edge-ends">
            {nodeById.get(selected.fromId)?.name} →{" "}
            {nodeById.get(selected.toId)?.name}
          </span>
          <select
            className="rel-kind-select"
            value={selected.kind}
            onChange={(e) =>
              retype(selected.id, e.target.value as ProjectRelationKind)
            }
            aria-label="Connection type"
          >
            {RELATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_OPTION_LABEL[k]}
              </option>
            ))}
          </select>
          {selected.createdInMeetingTitle && (
            <span className="muted pmap-edge-prov">
              from “{selected.createdInMeetingTitle}”
            </span>
          )}
          <button
            type="button"
            className="row-action danger"
            onClick={() => disconnect(selected.id)}
          >
            Disconnect
          </button>
          <button
            type="button"
            className="row-action"
            onClick={() => setSelectedEdge(null)}
          >
            Close
          </button>
        </div>
      )}

      {parked.length > 0 && (
        <div className="pmap-parked">
          <div className="ai-group-head">
            Parked ideas
            <span className="count">{parked.length}</span>
          </div>
          <ul className="pmap-parked-list">
            {parked.map((n) => (
              <li key={n.id} className="pmap-parked-row">
                <span>{n.name}</span>
                <button
                  type="button"
                  className="row-action"
                  onClick={() => promote(n.id)}
                >
                  Promote to project
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Narrow-screen rendering of the same data. */}
      <ul className="pmap-list">
        {listEdges.map((e) => {
          const from = nodeById.get(e.fromId);
          const to = nodeById.get(e.toId);
          if (!from || !to) return null;
          const outgoing = e.fromId === centreId;
          const subject = outgoing ? to : from;
          const label = relationLabel(e.kind, outgoing ? "out" : "in");
          return (
            <li key={e.id} className="pmap-list-row">
              <button
                type="button"
                className="pmap-list-name"
                onClick={() => open(subject.id)}
              >
                {subject.name}
              </button>
              <span className="attach-meta">
                {label}
                {subject.status === "parked" && " · parked"}
                {e.createdInMeetingTitle && ` · from “${e.createdInMeetingTitle}”`}
              </span>
              <button
                type="button"
                className="note-remove"
                onClick={() => disconnect(e.id)}
                aria-label={`Disconnect ${from.name} from ${to.name}`}
              >
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      {wide && (
        <div className="pmap-footnote">
          <GraphLegend />
          <p className="muted pmap-legend">
            Drag a node&apos;s crosshair onto another to connect them — or click
            the crosshair, then the other project. Click a line to retype or
            remove it.
          </p>
        </div>
      )}
    </div>
  );
}
