"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ProjectRelationKind, ProjectStatus } from "@/db/schema";
import {
  KIND_OPTION_LABEL,
  RELATION_KINDS,
  relationLabel,
} from "../relation-kinds";

export type MapNode = {
  id: string;
  name: string;
  status: ProjectStatus;
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

const WIDTH = 760;
const HEIGHT = 520;
const RING = [0, 175, 250];

const CrosshairIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
    <circle cx="10" cy="10" r="6" strokeWidth="1.5" />
    <path
      d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3"
      strokeWidth="1.5"
      strokeLinecap="round"
    />
  </svg>
);

type Placed = MapNode & { x: number; y: number };

// Deterministic polar layout: centre, then one ring per hop with the ring's
// nodes spread evenly. No simulation — positions are stable across renders and
// there's no layout library in this app to reach for.
function layout(nodes: MapNode[]): Map<string, Placed> {
  const placed = new Map<string, Placed>();
  const byHop = new Map<number, MapNode[]>();
  for (const n of nodes) {
    const list = byHop.get(n.hop) ?? [];
    list.push(n);
    byHop.set(n.hop, list);
  }
  const cx = WIDTH / 2;
  const cy = HEIGHT / 2;
  // Scale the rings so the outermost one fills the canvas whatever the depth,
  // leaving a margin for the bubbles' own width/height. Separate x and y
  // factors because the canvas is much wider than it is tall.
  const maxHop = Math.max(...nodes.map((n) => n.hop), 1);
  const maxRadius = RING[Math.min(maxHop, RING.length - 1)];
  const fx = (WIDTH / 2 - 70) / maxRadius;
  const fy = (HEIGHT / 2 - 30) / maxRadius;
  for (const [hop, list] of byHop) {
    if (hop === 0) {
      for (const n of list) placed.set(n.id, { ...n, x: cx, y: cy });
      continue;
    }
    const radius = RING[Math.min(hop, RING.length - 1)];
    // Start at 12 o'clock and offset even rings so ring 2 doesn't hide behind
    // ring 1's spokes.
    const offset = hop % 2 === 0 ? Math.PI / list.length : 0;
    list.forEach((n, i) => {
      const angle = (i / list.length) * Math.PI * 2 - Math.PI / 2 + offset;
      placed.set(n.id, {
        ...n,
        x: cx + Math.cos(angle) * radius * fx,
        y: cy + Math.sin(angle) * radius * fy,
      });
    });
  }
  return placed;
}

// Node bubbles are wide and short, so a single circular inset would leave a
// vertical edge floating in space while a horizontal one still ran under the
// label. Trim to where the line exits an ellipse of the bubble's proportions.
const NODE_RX = 58;
const NODE_RY = 17;

function trim(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { x: number; y: number } {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const by = 1 / Math.hypot(ux / NODE_RX, uy / NODE_RY);
  return { x: x2 - ux * by, y: y2 - uy * by };
}

// Hoisted to module scope for the same reason as the dependency view's Row:
// every pointermove during a drag updates parent state, and a component defined
// inline would be a new type each render, remounting the node that holds
// pointer capture and freezing the drag mid-gesture.
function Node({
  node,
  isCentre,
  isDropTarget,
  onOpen,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  node: Placed;
  isCentre: boolean;
  isDropTarget: boolean;
  onOpen: (id: string) => void;
  onDragStart: (e: React.PointerEvent, id: string) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      className={`pmap-node ${isCentre ? "centre" : ""} ${
        node.status === "parked" ? "parked" : ""
      } ${node.status === "archived" ? "archived" : ""} ${
        isDropTarget ? "drop-target" : ""
      }`}
      data-project-id={node.id}
      // Percentages, not pixels: the canvas is locked to the viewBox's aspect
      // ratio, so a percentage lands on exactly the same spot as the SVG
      // coordinate it came from at any container width. Pixel positioning would
      // put nodes and edges in different coordinate spaces.
      style={{
        left: `${(node.x / WIDTH) * 100}%`,
        top: `${(node.y / HEIGHT) * 100}%`,
      }}
    >
      <button
        type="button"
        className="pmap-node-label"
        onClick={() => onOpen(node.id)}
        title={node.name}
      >
        {node.name}
      </button>
      <button
        type="button"
        className="pmap-crosshair"
        title="Drag to another project to connect them"
        aria-label={`Connect ${node.name} to another project`}
        onPointerDown={(e) => onDragStart(e, node.id)}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
      >
        <CrosshairIcon />
      </button>
    </div>
  );
}

export function ProjectMap({
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

  const containerRef = useRef<HTMLDivElement>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const placed = useMemo(() => layout(nodes), [nodes]);
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  function fail(message: string) {
    setError(message);
    setTimeout(() => setError(null), 2500);
  }

  function open(id: string) {
    if (id === centreId) return;
    router.push(`/projects/${id}?tab=map`);
  }

  // Pointer coords arrive in CSS pixels; the rubber band is drawn inside the
  // SVG's viewBox, so convert rather than mixing the two spaces.
  function toViewBox(e: React.PointerEvent): { x: number; y: number } {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * HEIGHT,
    };
  }

  function startDrag(e: React.PointerEvent, id: string) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const origin = toViewBox(e);
    setDragFrom(id);
    setDragOrigin(origin);
    setDragPos(origin);
  }

  function onDragMove(e: React.PointerEvent) {
    if (!dragFrom) return;
    setDragPos(toViewBox(e));
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const el = under?.closest<HTMLElement>("[data-project-id]");
    const id = el?.dataset.projectId ?? null;
    setDropTargetId(id && id !== dragFrom ? id : null);
  }

  async function onDragEnd(e: React.PointerEvent) {
    const source = dragFrom;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const el = under?.closest<HTMLElement>("[data-project-id]");
    const targetId = el?.dataset.projectId ?? null;
    setDragFrom(null);
    setDragOrigin(null);
    setDragPos(null);
    setDropTargetId(null);
    if (!source || !targetId || targetId === source) return;

    try {
      const res = await fetch("/api/project-relations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromId: source, toId: targetId, kind: "related" }),
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

  const selected = edges.find((e) => e.id === selectedEdge) ?? null;
  const parked = nodes.filter((n) => n.status === "parked");
  // The narrow-screen list: the centre's own edges.
  const listEdges = edges.filter(
    (e) => e.fromId === centreId || e.toId === centreId,
  );

  return (
    <div className="pmap">
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

      {/* Canvas: hidden on narrow screens, where the list below takes over —
          a pannable graph would push the sticky top bar off-screen. */}
      <div className="pmap-canvas" ref={containerRef}>
        <svg
          className="pmap-svg"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <marker
              id="pmap-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" className="pmap-arrowhead" />
            </marker>
          </defs>
          {edges.map((e) => {
            const a = placed.get(e.fromId);
            const b = placed.get(e.toId);
            if (!a || !b) return null;
            const end = trim(a.x, a.y, b.x, b.y);
            const start = trim(b.x, b.y, a.x, a.y);
            const flow = e.kind === "blocks" || e.kind === "depends_on";
            return (
              <line
                key={e.id}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                className={`pmap-edge kind-${e.kind} ${
                  selectedEdge === e.id ? "on" : ""
                }`}
                markerEnd={flow ? "url(#pmap-arrow)" : undefined}
                onClick={() =>
                  setSelectedEdge((s) => (s === e.id ? null : e.id))
                }
              />
            );
          })}
          {dragFrom && dragOrigin && dragPos && (
            <line
              x1={dragOrigin.x}
              y1={dragOrigin.y}
              x2={dragPos.x}
              y2={dragPos.y}
              className="pmap-drag-line"
            />
          )}
        </svg>

        {nodes.map((n) => {
          const p = placed.get(n.id);
          if (!p) return null;
          return (
            <Node
              key={n.id}
              node={p}
              isCentre={n.id === centreId}
              isDropTarget={dropTargetId === n.id}
              onOpen={open}
              onDragStart={startDrag}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
            />
          );
        })}
      </div>

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

      <p className="muted pmap-legend">
        Drag a node&apos;s crosshair onto another to connect them. Click a line to
        retype or remove it.
      </p>
    </div>
  );
}
