"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Connection,
  type Edge,
  type Node as FlowNode,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { ProjectRelationKind, ProjectStatus } from "@/db/schema";
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
import {
  centreComposition,
  layoutOverview,
  placeNear,
  radialTree,
  type Point,
} from "../project-graph-layout";
import { projectGraphState, todayLocal } from "../project-graph-state";
import { MapStyleLab, useBubbleStyle } from "./map-style-lab";
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
  openTasks: number;
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

type Task = { id: string; content: string };

// How far out from the focused project the map draws. Two hops is the limit of
// what stays *readable* — the canvas pans and zooms now, but a third ring turns
// a branch diagram into a hairball. Anything further out is reached by
// re-centring or through the Jump box.
const MAX_HOP = 2;
const TWEEN_MS = 380;

const ExpandIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
    <path
      d="M7.5 3.5h-4v4M12.5 3.5h4v4M7.5 16.5h-4v-4M12.5 16.5h4v-4"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

type Reach = { hop: number; parent: string | null };

// Hops from the focused project, walking edges in both directions. The parent
// is kept so the outer ring can grow out of its own branch instead of being
// scattered around the circle.
function reachFrom(focusId: string, edges: MapEdge[]): Map<string, Reach> {
  const reach = new Map<string, Reach>([[focusId, { hop: 0, parent: null }]]);
  let frontier = [focusId];
  for (let h = 1; h <= MAX_HOP; h++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of edges) {
        const other = e.fromId === id ? e.toId : e.toId === id ? e.fromId : null;
        if (!other || reach.has(other)) continue;
        reach.set(other, { hop: h, parent: id });
        next.push(other);
      }
    }
    frontier = next;
  }
  return reach;
}

export function MapWorkspace(props: {
  initialNodes: MapNode[];
  initialEdges: MapEdge[];
  initialFocusId: string | null;
}) {
  // React Flow needs its context above anything that reads node internals —
  // the custom edge does, to follow the tween.
  return (
    <ReactFlowProvider>
      <MapWorkspaceInner {...props} />
    </ReactFlowProvider>
  );
}

function MapWorkspaceInner({
  initialNodes,
  initialEdges,
  initialFocusId,
}: {
  initialNodes: MapNode[];
  initialEdges: MapEdge[];
  initialFocusId: string | null;
}) {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const [focusId, setFocusId] = useState<string | null>(initialFocusId);
  const [selectedId, setSelectedId] = useState<string | null>(initialFocusId);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 960, h: 600 });
  const [isFullscreen, setFullscreen] = useState(false);
  // Fixed for the session: a bubble's colour shouldn't change under you at
  // midnight mid-session, and re-deriving it every render is pointless churn.
  const [today] = useState(todayLocal);

  // Bubble appearance: the shipped defaults unless this browser has saved an
  // override through the style palette.
  const [labValues, setLabValues] = useBubbleStyle();

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // focusId null = the overview: the whole ecosystem, connected or not. It is
  // the default, and ?focus= is the only thing that opens centred.
  const overview = focusId === null;

  // The layouts size themselves to the stage so the graph opens fitting the
  // screen. Deliberately measured on the *body* — canvas plus panel — not the
  // canvas: opening the side panel narrows the canvas, and measuring that would
  // re-lay-out and slide the entire board out from under the pointer the moment
  // you selected anything. (That cost a double-click its target: the first
  // click selected, the board moved, the second click landed on empty pane.)
  // Panning and zooming move the viewport over the composition; they never
  // change where a node sits in graph space.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const reach = useMemo(
    () => (focusId ? reachFrom(focusId, edges) : new Map<string, Reach>()),
    [focusId, edges],
  );
  const visibleNodes = useMemo(
    () => (overview ? nodes : nodes.filter((n) => reach.has(n.id))),
    [overview, nodes, reach],
  );
  const visibleEdges = useMemo(
    () =>
      overview
        ? edges
        : edges.filter((e) => reach.has(e.fromId) && reach.has(e.toId)),
    [overview, edges, reach],
  );
  // A full re-layout is a deliberate event, not something that happens every
  // time the graph changes. Adding a project, drawing a connection or removing
  // one leaves every existing bubble exactly where it is — otherwise capturing
  // an idea mid-meeting makes the whole board rearrange itself, which reads as
  // a page reload rather than "a thing appeared". Relayout happens on: mount,
  // switching between overview and focus, a resize, and the Tidy button.
  const layoutKey = `${overview ? "overview" : focusId}|${Math.round(size.w)}x${Math.round(size.h)}|${labValues.ringGap}x${labValues.squash}|${labValues.arrangement}`;
  const [tidyCount, setTidy] = useState(0);

  const computeLayout = useCallback((): Map<string, Point> => {
    const spacing = {
      ringGap: labValues.ringGap,
      squash: labValues.squash,
      arrangement: labValues.arrangement,
    };
    if (overview) return layoutOverview(nodes, edges, size, spacing);
    // Focus mode is the same radial tree, just rooted on the focused project
    // and cut off at two hops by `reach`.
    const ids = visibleNodes.map((n) => n.id);
    const adj = new Map<string, string[]>();
    for (const id of ids) adj.set(id, []);
    for (const e of visibleEdges) {
      adj.get(e.fromId)?.push(e.toId);
      adj.get(e.toId)?.push(e.fromId);
    }
    for (const [id, list] of adj) {
      adj.set(
        id,
        list.sort((a, b) =>
          (nodeById.get(a)?.name ?? "").localeCompare(
            nodeById.get(b)?.name ?? "",
          ),
        ),
      );
    }
    const { points } = radialTree(focusId as string, ids, adj, spacing);
    const centred = new Map<string, Point>();
    for (const [id, p] of points) {
      centred.set(id, { x: size.w / 2 + p.x, y: size.h / 2 + p.y });
    }
    return centreComposition(centred, size);
  }, [
    overview,
    nodes,
    edges,
    size,
    visibleNodes,
    visibleEdges,
    focusId,
    nodeById,
    labValues.ringGap,
    labValues.squash,
    labValues.arrangement,
  ]);

  const [targets, setTargets] = useState<Map<string, Point>>(() => new Map());
  const computeRef = useRef(computeLayout);
  useEffect(() => {
    computeRef.current = computeLayout;
  }, [computeLayout]);

  const { fitView } = useReactFlow();

  useEffect(() => {
    setTargets(computeRef.current());
    // Frame whatever was just laid out. Waiting out the tween matters twice
    // over: fitView reads live node positions, so firing early would fit the
    // half-animated board, and by now the side panel has opened and narrowed
    // the canvas — so the fit accounts for it instead of leaving nodes behind
    // the panel. Only full relayouts refit; selecting or connecting must never
    // move the viewport.
    const t = setTimeout(() => {
      void fitView({ padding: 0.16, duration: 320, maxZoom: 1 });
    }, TWEEN_MS + 80);
    return () => clearTimeout(t);
    // computeLayout is deliberately read through a ref: this must fire when the
    // view or the stage changes, NOT every time a node or edge does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, tidyCount]);

  // Nodes that appeared since the last layout get hung off whatever they're
  // connected to; nodes that vanished are dropped. Nothing else moves.
  useEffect(() => {
    setTargets((prev) => {
      const wanted = new Set(visibleNodes.map((n) => n.id));
      const missing = visibleNodes.filter((n) => !prev.has(n.id));
      const stale = [...prev.keys()].filter((id) => !wanted.has(id));
      if (missing.length === 0 && stale.length === 0) return prev;
      // Nothing placed yet — the layout effect above is about to run.
      if (prev.size === 0) return prev;
      const next = new Map(prev);
      for (const id of stale) next.delete(id);
      for (const n of missing) {
        const link = visibleEdges.find(
          (e) => e.fromId === n.id || e.toId === n.id,
        );
        const anchor = link
          ? link.fromId === n.id
            ? link.toId
            : link.fromId
          : "";
        next.set(n.id, placeNear(n.id, anchor, next));
      }
      return next;
    });
  }, [visibleNodes, visibleEdges]);

  // Tween node positions rather than snapping. The interpolated points are fed
  // straight into React Flow's controlled `nodes`, and the custom edge reads
  // live node positions, so lines travel with their nodes instead of jumping a
  // frame ahead — that's most of what makes re-centring feel native.
  const [points, setPoints] = useState<Map<string, Point>>(targets);
  const pointsRef = useRef(points);
  const frameRef = useRef<number | null>(null);

  // Mirrored in an effect, not during render: React can discard or replay a
  // render, and a ref written there could hold positions that never committed —
  // the next tween would then interpolate from somewhere never drawn. Declared
  // before the tween effect so the tween always starts from what's on screen.
  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    const from = new Map(pointsRef.current);
    const centre = { x: size.w / 2, y: size.h / 2 };
    const start = performance.now();
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TWEEN_MS);
      const k = easeInOutCubic(t);
      const next = new Map<string, Point>();
      for (const [id, to] of targets) {
        // Nodes entering the view grow out of the centre rather than sliding
        // in from wherever they happened to be last time.
        const a = from.get(id) ?? centre;
        next.set(id, { x: a.x + (to.x - a.x) * k, y: a.y + (to.y - a.y) * k });
      }
      setPoints(next);
      if (t < 1) frameRef.current = requestAnimationFrame(step);
    };
    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [targets, size.w, size.h]);

  const fail = useCallback((message: string) => {
    setError(message);
    setTimeout(() => setError(null), 2600);
  }, []);

  // In the overview a click only selects, so inspecting or connecting something
  // never yanks the board out from under you. Once you're centred on a project,
  // clicking a neighbour re-centres — that's the navigation model in focus mode.
  // Either way it's state, never a route change.
  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      setSelectedEdgeId(null);
      if (!overview) setFocusId(id);
    },
    [overview],
  );

  // Double-click (or the panel's button) centres from anywhere.
  const centreOn = useCallback((id: string) => {
    setSelectedId(id);
    setSelectedEdgeId(null);
    setFocusId(id);
  }, []);

  async function toggleFullscreen() {
    const el = stageRef.current;
    if (!el) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await el.requestFullscreen();
    } catch {
      fail("Fullscreen isn't available here.");
    }
  }

  // ---- mutations ----
  const connect = useCallback(
    async (fromId: string, toId: string, kind: ProjectRelationKind) => {
      try {
        const res = await fetch("/api/project-relations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fromId, toId, kind }),
        });
        const data = (await res.json()) as {
          relation?: MapEdge;
          error?: string;
        };
        if (!res.ok || !data.relation) {
          fail(data.error ?? "Could not connect those projects.");
          return;
        }
        setEdges((es) => [...es, data.relation as MapEdge]);
      } catch {
        fail("Could not connect those projects.");
      }
    },
    [fail],
  );

  const retype = useCallback(
    async (edgeId: string, kind: ProjectRelationKind) => {
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
    },
    [edges, fail],
  );

  const disconnect = useCallback(
    async (edgeId: string) => {
      const prev = edges;
      setEdges((es) => es.filter((e) => e.id !== edgeId));
      setSelectedEdgeId(null);
      try {
        const res = await fetch(`/api/project-relations/${edgeId}`, {
          method: "DELETE",
        });
        if (!res.ok) throw new Error();
      } catch {
        setEdges(prev);
        fail("Could not remove that connection.");
      }
    },
    [edges, fail],
  );

  async function captureIdea(name: string, kind: ProjectRelationKind) {
    if (!selectedId) return;
    try {
      const res = await fetch("/api/project-relations/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromProjectId: selectedId, name, kind }),
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
          openTasks: 0,
        },
      ]);
      setEdges((es) => [...es, data.relation as MapEdge]);
    } catch {
      fail("Could not add that.");
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
    } catch {
      setNodes(prev);
      fail("Could not promote that idea.");
    }
  }

  // ---- React Flow model ----
  const activateEdge = useCallback((id: string) => {
    setSelectedEdgeId((s) => (s === id ? null : id));
  }, []);

  const flowNodes = useMemo<FlowNode<ProjectNodeData>[]>(
    () =>
      visibleNodes.flatMap((n) => {
        const p = points.get(n.id);
        if (!p) return [];
        return [
          {
            id: n.id,
            type: "project",
            position: p,
            data: {
              name: n.name,
              state: projectGraphState(n.status, n.deadline, today),
              badge: n.openTasks,
              isCentre: n.id === focusId,
              isFaded: (reach.get(n.id)?.hop ?? 0) > 1,
              isSelected: n.id === selectedId,
            },
          },
        ];
      }),
    [visibleNodes, points, selectedId, focusId, reach, today],
  );

  const flowEdges = useMemo<Edge<ProjectEdgeData>[]>(
    () =>
      visibleEdges.map((e) => ({
        id: e.id,
        type: "project",
        source: e.fromId,
        target: e.toId,
        selected: e.id === selectedEdgeId,
        data: {
          kind: e.kind,
          fromName: nodeById.get(e.fromId)?.name ?? "",
          toName: nodeById.get(e.toId)?.name ?? "",
          onActivate: activateEdge,
        },
      })),
    [visibleEdges, selectedEdgeId, nodeById, activateEdge],
  );

  // A completed click-to-connect also bubbles a click to the node underneath.
  // Without this the target project would be selected (and, in focus mode,
  // centred) the instant you finished wiring it up.
  const justConnected = useRef(false);
  const clickConnect = useClickConnect();

  // Double-click to centre is detected here rather than left to React Flow's
  // `onNodeDoubleClick`. The browser only synthesises `dblclick` when both
  // clicks share a target, and the first click re-renders the board — a node
  // that is re-created, re-ordered or re-measured in that window swallows the
  // gesture. Tracking two clicks on the same node id is immune to all of it.
  const lastClick = useRef<{ id: string; at: number }>({ id: "", at: 0 });
  const DOUBLE_CLICK_MS = 400;

  const onNodeActivate = useCallback(
    (id: string) => {
      const now = performance.now();
      const prev = lastClick.current;
      lastClick.current = { id, at: now };
      if (prev.id === id && now - prev.at < DOUBLE_CLICK_MS) {
        lastClick.current = { id: "", at: 0 };
        centreOn(id);
        return;
      }
      select(id);
    },
    [centreOn, select],
  );

  // The second half of the same gesture, for when it misses. Selecting a
  // project re-renders the board, and React Flow briefly renders a re-created
  // node un-hittable — so the second click of a double-click can land on empty
  // pane instead of the bubble. A pane click this soon after a node click is
  // physically that second click, so honour it as the centring gesture rather
  // than treating it as "clicked away".
  const onPaneActivate = useCallback(() => {
    const prev = lastClick.current;
    if (prev.id && performance.now() - prev.at < DOUBLE_CLICK_MS) {
      lastClick.current = { id: "", at: 0 };
      centreOn(prev.id);
      return;
    }
    setSelectedId(null);
    setSelectedEdgeId(null);
  }, [centreOn]);

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target || c.source === c.target) return;
      justConnected.current = true;
      setTimeout(() => {
        justConnected.current = false;
      }, 0);
      void connect(c.source, c.target, "related");
    },
    [connect],
  );

  const selected = selectedId ? nodeById.get(selectedId) : undefined;
  const selectedEdge = edges.find((e) => e.id === selectedEdgeId) ?? null;
  const hiddenCount = nodes.length - visibleNodes.length;

  return (
    <div
      className={`mapx ${isFullscreen ? "is-fullscreen" : ""} ${
        overview ? "is-overview" : ""
      }`}
      ref={stageRef}
    >
      <GraphDefs />
      <MapStyleLab
        values={labValues}
        onChange={setLabValues}
        stageRef={stageRef}
      />
      <div className="mapx-bar">
        <JumpBox nodes={nodes} onPick={centreOn} />
        {!overview && (
          <button
            type="button"
            className="ghost-btn mapx-back"
            onClick={() => setFocusId(null)}
          >
            ‹ Everything
          </button>
        )}
        <button
          type="button"
          className="ghost-btn mapx-tidy"
          onClick={() => setTidy((n) => n + 1)}
          title="Re-arrange the board around its connections"
        >
          Tidy
        </button>
        <GraphLegend className="mapx-legend" />
        <span className="muted mapx-bar-meta">
          {overview
            ? `${nodes.length} project${nodes.length === 1 ? "" : "s"} · ${edges.length} connection${edges.length === 1 ? "" : "s"}`
            : `${visibleNodes.length} shown${hiddenCount > 0 ? ` · ${hiddenCount} not connected to this` : ""}`}
        </span>
        <button
          type="button"
          className="ghost-btn mapx-fs"
          onClick={toggleFullscreen}
          aria-pressed={isFullscreen}
        >
          <ExpandIcon />
          {isFullscreen ? "Exit full screen" : "Full screen"}
        </button>
      </div>

      <div className="mapx-body" ref={bodyRef}>
        {/* Overlaid, not stacked above the body: an error or the connect banner
            appearing would otherwise shrink the stage, and the layout would
            re-run and slide the whole board — the same jump the side panel used
            to cause. Transient chrome must never be a layout input. */}
        {error && <p className="login-error mapx-error">{error}</p>}
        {clickConnect.armedFrom && (
          <ConnectBanner
            name={nodeById.get(clickConnect.armedFrom)?.name ?? "this project"}
            onCancel={clickConnect.cancel}
          />
        )}

        <div className="mapx-canvas">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            // Positions are computed by the layouts above and re-derived on
            // every focus change, so a hand-dragged node would be clobbered by
            // the next tween. Nothing persists a manual position.
            nodesDraggable={false}
            // React Flow reorders the node DOM to raise a selected node. That
            // detaches and re-inserts the element mid-gesture, which resets the
            // browser's click tracking and kills the double-click that centres.
            elevateNodesOnSelect={false}
            nodesConnectable
            // The custom edge puts role/tabIndex/Enter-Space on the path
            // itself, so React Flow's own edge focus would be a second,
            // duplicate tab stop on the wrapper.
            edgesFocusable={false}
            elementsSelectable
            // The layouts already place a node by its centre.
            nodeOrigin={[0.5, 0.5]}
            defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            minZoom={0.2}
            maxZoom={2}
            zoomOnDoubleClick={false}
            proOptions={{ hideAttribution: false }}
            onNodeClick={(_, n) => {
              if (justConnected.current) return;
              onNodeActivate(n.id);
            }}
            onEdgeClick={(_, e) => activateEdge(e.id)}
            onConnect={onConnect}
            onClickConnectStart={clickConnect.onClickConnectStart}
            onClickConnectEnd={clickConnect.onClickConnectEnd}
            onPaneClick={onPaneActivate}
          >
            <Background variant={BackgroundVariant.Dots} gap={26} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>

          {visibleNodes.length === 0 && (
            <p className="ai-empty mapx-empty">No projects to map yet.</p>
          )}

          {selectedEdge && (
            <div className="mapx-edge-editor">
              <span>
                {nodeById.get(selectedEdge.fromId)?.name} →{" "}
                {nodeById.get(selectedEdge.toId)?.name}
              </span>
              <select
                className="rel-kind-select"
                value={selectedEdge.kind}
                onChange={(e) =>
                  retype(selectedEdge.id, e.target.value as ProjectRelationKind)
                }
                aria-label="Connection type"
              >
                {RELATION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_OPTION_LABEL[k]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="row-action danger"
                onClick={() => disconnect(selectedEdge.id)}
              >
                Disconnect
              </button>
              <button
                type="button"
                className="row-action"
                onClick={() => setSelectedEdgeId(null)}
              >
                Close
              </button>
            </div>
          )}
        </div>

        {selected && (
          <DetailPanel
            key={selected.id}
            node={selected}
            edges={edges}
            nodeById={nodeById}
            allNodes={nodes}
            onFocus={overview ? select : centreOn}
            onCentre={() => centreOn(selected.id)}
            isOverview={overview}
            onConnect={(toId, kind) => connect(selected.id, toId, kind)}
            onCapture={captureIdea}
            onRetype={retype}
            onDisconnect={disconnect}
            onPromote={() => promote(selected.id)}
            onClose={() => setSelectedId(null)}
            onTaskCountChange={(delta) =>
              setNodes((ns) =>
                ns.map((n) =>
                  n.id === selected.id
                    ? { ...n, openTasks: Math.max(0, n.openTasks + delta) }
                    : n,
                ),
              )
            }
            onFail={fail}
          />
        )}
      </div>
    </div>
  );
}

// Type-ahead over every project in the workspace — the way to reach anything
// the current focus doesn't reach within two hops.
function JumpBox({
  nodes,
  onPick,
}: {
  nodes: MapNode[];
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as globalThis.Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const matches = q.trim()
    ? nodes
        .filter((n) => n.name.toLowerCase().includes(q.trim().toLowerCase()))
        .slice(0, 8)
    : [];

  return (
    <div className="mapx-jump" ref={wrapRef}>
      <input
        type="text"
        placeholder="Jump to a project…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        autoComplete="off"
        spellCheck={false}
      />
      {open && matches.length > 0 && (
        <div className="mapx-jump-results">
          {matches.map((n) => (
            <button
              key={n.id}
              type="button"
              className="attach-result"
              onClick={() => {
                onPick(n.id);
                setQ("");
                setOpen(false);
              }}
            >
              <span className="attach-title">{n.name}</span>
              {n.status === "parked" && (
                <span className="attach-meta">parked</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailPanel({
  node,
  edges,
  nodeById,
  allNodes,
  onFocus,
  onCentre,
  isOverview,
  onConnect,
  onCapture,
  onRetype,
  onDisconnect,
  onPromote,
  onClose,
  onTaskCountChange,
  onFail,
}: {
  node: MapNode;
  edges: MapEdge[];
  nodeById: Map<string, MapNode>;
  allNodes: MapNode[];
  onFocus: (id: string) => void;
  onCentre: () => void;
  isOverview: boolean;
  onConnect: (toId: string, kind: ProjectRelationKind) => Promise<void>;
  onCapture: (name: string, kind: ProjectRelationKind) => Promise<void>;
  onRetype: (edgeId: string, kind: ProjectRelationKind) => void;
  onDisconnect: (edgeId: string) => void;
  onPromote: () => void;
  onClose: () => void;
  onTaskCountChange: (delta: number) => void;
  onFail: (message: string) => void;
}) {
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [draft, setDraft] = useState("");
  const [connectQuery, setConnectQuery] = useState("");
  const [connectKind, setConnectKind] = useState<ProjectRelationKind>("related");
  // A ref, not state: two fast Enters both read the same render's state, so a
  // state flag wouldn't close the window between them.
  const addingRef = useRef(false);

  // Tasks are the one thing not already in the graph payload, so they load per
  // selection. Keyed by node id upstream, so switching projects refetches.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/action-items?projectId=${node.id}`);
        const data = (await res.json()) as { items?: Task[] };
        if (!cancelled) setTasks(data.items ?? []);
      } catch {
        if (!cancelled) setTasks([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [node.id]);

  const related = edges
    .filter((e) => e.fromId === node.id || e.toId === node.id)
    .map((e) => {
      const outgoing = e.fromId === node.id;
      const other = nodeById.get(outgoing ? e.toId : e.fromId);
      return { edge: e, other, direction: outgoing ? "out" : "in" } as const;
    })
    .filter((r) => r.other !== undefined);

  const connectMatches = connectQuery.trim()
    ? allNodes
        .filter(
          (n) =>
            n.id !== node.id &&
            !related.some((r) => r.other?.id === n.id) &&
            n.name.toLowerCase().includes(connectQuery.trim().toLowerCase()),
        )
        .slice(0, 6)
    : [];
  const exact = connectMatches.some(
    (n) => n.name.toLowerCase() === connectQuery.trim().toLowerCase(),
  );

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || addingRef.current) return;
    addingRef.current = true;
    setDraft("");
    try {
      const res = await fetch("/api/action-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, projectId: node.id }),
      });
      const data = (await res.json()) as { item?: Task; error?: string };
      if (!res.ok || !data.item) {
        onFail(data.error ?? "Could not add that task.");
        return;
      }
      setTasks((t) => [...(t ?? []), data.item as Task]);
      onTaskCountChange(1);
    } catch {
      onFail("Could not add that task.");
    } finally {
      addingRef.current = false;
    }
  }

  async function completeTask(id: string) {
    const prev = tasks;
    setTasks((t) => (t ?? []).filter((x) => x.id !== id));
    onTaskCountChange(-1);
    try {
      const res = await fetch(`/api/action-items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setTasks(prev ?? []);
      onTaskCountChange(1);
      onFail("Could not complete that task.");
    }
  }

  return (
    <aside className="mapx-panel">
      <div className="mapx-panel-head">
        <div>
          <h2 className="mapx-panel-title">{node.name}</h2>
          <p className="muted mapx-panel-meta">
            {node.status === "parked" ? "Parked idea" : "Project"}
            {node.deadline && ` · due ${node.deadline}`}
          </p>
        </div>
        <button
          type="button"
          className="note-remove"
          onClick={onClose}
          aria-label="Close panel"
        >
          ✕
        </button>
      </div>

      <div className="mapx-panel-actions">
        {isOverview && (
          <button type="button" className="ghost-btn ghost-btn-sm" onClick={onCentre}>
            Centre on this
          </button>
        )}
        <Link href={`/projects/${node.id}`} className="ghost-btn ghost-btn-sm">
          Open project
        </Link>
        {node.status === "parked" && (
          <button type="button" className="ghost-btn ghost-btn-sm" onClick={onPromote}>
            Promote
          </button>
        )}
      </div>

      <section className="mapx-panel-section">
        <h3 className="mapx-panel-h">Connections</h3>
        {related.length === 0 ? (
          <p className="muted empty-sm">Nothing connected yet.</p>
        ) : (
          <ul className="mapx-rel-list">
            {related.map(({ edge, other, direction }) => (
              <li key={edge.id} className="mapx-rel-row">
                <button
                  type="button"
                  className="mapx-rel-name"
                  onClick={() => onFocus(other!.id)}
                >
                  {other!.name}
                </button>
                <select
                  className="rel-kind-select"
                  value={edge.kind}
                  onChange={(e) =>
                    onRetype(edge.id, e.target.value as ProjectRelationKind)
                  }
                  aria-label={`How ${other!.name} relates`}
                >
                  {RELATION_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {relationLabel(k, direction)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="note-remove"
                  onClick={() => onDisconnect(edge.id)}
                  aria-label={`Disconnect ${other!.name}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mapx-connect">
          <select
            className="rel-kind-select"
            value={connectKind}
            onChange={(e) =>
              setConnectKind(e.target.value as ProjectRelationKind)
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
            placeholder="Connect or create…"
            value={connectQuery}
            onChange={(e) => setConnectQuery(e.target.value)}
            onKeyDown={async (e) => {
              if (e.key === "Enter" && connectQuery.trim() && !exact) {
                e.preventDefault();
                const name = connectQuery.trim();
                setConnectQuery("");
                await onCapture(name, connectKind);
              }
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        {connectQuery.trim().length > 0 && (
          <div className="attach-results mapx-connect-results">
            {connectMatches.map((n) => (
              <button
                key={n.id}
                type="button"
                className="attach-result"
                onClick={async () => {
                  setConnectQuery("");
                  await onConnect(n.id, connectKind);
                }}
              >
                <span className="attach-title">{n.name}</span>
                <span className="attach-meta">existing project</span>
              </button>
            ))}
            {!exact && (
              <button
                type="button"
                className="attach-result rel-create"
                onClick={async () => {
                  const name = connectQuery.trim();
                  setConnectQuery("");
                  await onCapture(name, connectKind);
                }}
              >
                <span className="attach-title">{`Create “${connectQuery.trim()}”`}</span>
                <span className="attach-meta">parked idea, connected here</span>
              </button>
            )}
          </div>
        )}
      </section>

      <section className="mapx-panel-section">
        <h3 className="mapx-panel-h">
          Open tasks
          {tasks && tasks.length > 0 && (
            <span className="count">{tasks.length}</span>
          )}
        </h3>
        <form className="mapx-task-add" onSubmit={addTask}>
          <input
            type="text"
            placeholder="Add a task…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
          />
        </form>
        {tasks === null ? (
          <p className="muted empty-sm">Loading…</p>
        ) : tasks.length === 0 ? (
          <p className="muted empty-sm">Nothing open.</p>
        ) : (
          <ul className="mapx-task-list">
            {tasks.map((t) => (
              <li key={t.id} className="mapx-task-row">
                <button
                  type="button"
                  className="mapx-task-check"
                  onClick={() => completeTask(t.id)}
                  aria-label={`Complete ${t.content}`}
                />
                <span>{t.content}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </aside>
  );
}
