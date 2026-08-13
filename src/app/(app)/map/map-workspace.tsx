"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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

type Point = { x: number; y: number };
type Task = { id: string; content: string };

// How far out from the focused project the map draws. Two hops is the limit of
// what stays readable without pan/zoom, and the whole point here is that the
// stage never scrolls.
const MAX_HOP = 2;
const NODE_RX = 78;
const NODE_RY = 19;
const TWEEN_MS = 380;

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

// Deterministic polar placement sized to the live stage, so the graph always
// fits the box it's given — there is nothing to scroll or pan.
function layout(
  reach: Map<string, Reach>,
  order: string[],
  size: { w: number; h: number },
): Map<string, Point> {
  const out = new Map<string, Point>();
  const angles = new Map<string, number>();
  const cx = size.w / 2;
  const cy = size.h / 2;
  const byHop = new Map<number, string[]>();
  for (const id of order) {
    const r = reach.get(id);
    if (!r) continue;
    byHop.set(r.hop, [...(byHop.get(r.hop) ?? []), id]);
  }
  const maxHop = Math.max(...[...byHop.keys()], 1);
  const outerRx = Math.max(130, cx - 120);
  const outerRy = Math.max(80, cy - 70);
  // With two rings the inner one sits a bit past halfway, which keeps ring-one
  // labels clear of the centre without crowding the outer ring.
  const ringScale = (hop: number) => (maxHop === 1 ? 1 : hop === 1 ? 0.56 : 1);

  for (const id of byHop.get(0) ?? []) {
    out.set(id, { x: cx, y: cy });
    angles.set(id, 0);
  }

  const ring1 = byHop.get(1) ?? [];
  ring1.forEach((id, i) => {
    const angle = (i / ring1.length) * Math.PI * 2 - Math.PI / 2;
    angles.set(id, angle);
    out.set(id, {
      x: cx + Math.cos(angle) * outerRx * ringScale(1),
      y: cy + Math.sin(angle) * outerRy * ringScale(1),
    });
  });

  // Outer ring: fan each node out around its own parent's heading, so an edge
  // reads as a branch rather than a chord slicing across the centre.
  const outer = byHop.get(2) ?? [];
  const byParent = new Map<string, string[]>();
  for (const id of outer) {
    const p = reach.get(id)?.parent ?? "";
    byParent.set(p, [...(byParent.get(p) ?? []), id]);
  }
  for (const [parent, ids] of byParent) {
    const base = angles.get(parent) ?? 0;
    // Wide enough to separate siblings, tight enough to stay a branch.
    const spread = Math.min(1.15, 0.34 * ids.length);
    ids.forEach((id, i) => {
      const offset =
        ids.length === 1 ? 0 : -spread / 2 + (spread * i) / (ids.length - 1);
      const angle = base + offset;
      angles.set(id, angle);
      out.set(id, {
        x: cx + Math.cos(angle) * outerRx,
        y: cy + Math.sin(angle) * outerRy,
      });
    });
  }
  return out;
}

// The default view: everything in flight, connected or not. Each connected
// component gets a cell of a grid and orbits its best-connected project; a
// project with no relations yet is simply a component of one, so it sits in the
// same grid as a plain bubble rather than being exiled to a corner. That
// uniformity is what makes it feel like one board.
function layoutOverview(
  nodes: MapNode[],
  edges: MapEdge[],
  size: { w: number; h: number },
): Map<string, Point> {
  const out = new Map<string, Point>();
  const neighbours = new Map<string, Set<string>>();
  for (const n of nodes) neighbours.set(n.id, new Set());
  for (const e of edges) {
    neighbours.get(e.fromId)?.add(e.toId);
    neighbours.get(e.toId)?.add(e.fromId);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const groups: MapNode[][] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const group: MapNode[] = [];
    const queue = [n.id];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const node = byId.get(id);
      if (node) group.push(node);
      for (const nb of neighbours.get(id) ?? []) {
        if (!seen.has(nb)) queue.push(nb);
      }
    }
    groups.push(group);
  }
  // Clusters first, loose projects after — the eye starts where the structure is.
  groups.sort((a, b) => b.length - a.length);
  const clusters = groups.filter((g) => g.length > 1);
  const singles = groups.filter((g) => g.length === 1).map((g) => g[0]);

  // Two bands rather than one uniform grid: giving a lone bubble the same cell
  // as a five-project cluster wastes most of the board. Structure sits up top,
  // the not-yet-connected backlog packs tightly underneath.
  const hasBoth = clusters.length > 0 && singles.length > 0;
  // Clusters are capped rather than stretched: a four-project constellation
  // blown up to fill half the screen reads as four unrelated bubbles.
  const RING_RY = 118;
  const clusterRows =
    clusters.length === 0
      ? 0
      : Math.max(
          1,
          Math.ceil(
            clusters.length /
              Math.max(
                1,
                Math.round(
                  Math.sqrt((clusters.length * size.w) / Math.max(size.h, 1)),
                ),
              ),
          ),
        );
  const clusterH =
    clusters.length === 0
      ? 0
      : hasBoth
        ? Math.min(size.h * 0.72, clusterRows * (RING_RY * 2 + 80))
        : size.h;
  const singlesTop = clusterH;
  const singlesH = size.h - clusterH;

  if (clusters.length > 0) {
    const cols = Math.max(1, Math.ceil(clusters.length / clusterRows));
    const rows = clusterRows;
    const cellW = size.w / cols;
    const cellH = clusterH / rows;
    clusters.forEach((group, gi) => {
      const row = Math.floor(gi / cols);
      // Centre a short final row instead of left-aligning it.
      const inRow = Math.min(cols, clusters.length - row * cols);
      const rowW = size.w / inRow;
      const cx = (gi % cols) * rowW + rowW / 2;
      const cy = row * cellH + cellH / 2;
      const hub = [...group].sort(
        (a, b) =>
          (neighbours.get(b.id)?.size ?? 0) -
            (neighbours.get(a.id)?.size ?? 0) ||
          a.name.localeCompare(b.name),
      )[0];
      out.set(hub.id, { x: cx, y: cy });
      const ring = group.filter((n) => n.id !== hub.id);
      const rx = Math.max(72, Math.min(Math.min(rowW, cellW) / 2 - 55, 215));
      const ry = Math.max(34, Math.min(cellH / 2 - 30, RING_RY));
      ring.forEach((n, i) => {
        const angle = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
        out.set(n.id, {
          x: cx + Math.cos(angle) * rx,
          y: cy + Math.sin(angle) * ry,
        });
      });
    });
  }

  if (singles.length > 0) {
    // Pack to a comfortable bubble pitch, then spread whatever fits per row.
    const perRow = Math.max(
      1,
      Math.min(singles.length, Math.floor(size.w / 175)),
    );
    const rows = Math.ceil(singles.length / perRow);
    const rowH = Math.min(96, singlesH / rows);
    singles.forEach((n, i) => {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, singles.length - row * perRow);
      const gap = size.w / (inRow + 1);
      out.set(n.id, {
        x: gap * ((i % perRow) + 1),
        y: singlesTop + 40 + row * rowH + rowH / 2,
      });
    });
  }

  // Both bands are laid out against their own budget, which can leave the whole
  // composition sitting high. Centre what was actually drawn.
  const ys = [...out.values()].map((p) => p.y);
  if (ys.length > 0) {
    const shift = size.h / 2 - (Math.min(...ys) + Math.max(...ys)) / 2;
    for (const [id, p] of out) out.set(id, { x: p.x, y: p.y + shift });
  }

  return out;
}

// Stop a line at the bubble's edge. Bubbles are wide and short, so trim to an
// ellipse rather than a circle or vertical edges float in space.
function trim(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const by = Math.min(len / 2, 1 / Math.hypot(ux / NODE_RX, uy / NODE_RY));
  return { x: to.x - ux * by, y: to.y - uy * by };
}

// Module scope keeps the component identity stable across the state churn of a
// drag — an inline definition would remount the node mid-gesture and kill the
// pointer capture that makes drag-to-connect work.
function Node({
  node,
  point,
  hop,
  isFocus,
  isSelected,
  isDropTarget,
  isLinkSource,
  isLinkTarget,
  onSelect,
  onCentre,
  onStartLink,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  node: MapNode;
  point: Point;
  hop: number;
  isFocus: boolean;
  isSelected: boolean;
  isDropTarget: boolean;
  isLinkSource: boolean;
  isLinkTarget: boolean;
  onSelect: (id: string) => void;
  onCentre: (id: string) => void;
  onStartLink: (id: string) => void;
  onDragStart: (e: React.PointerEvent, id: string) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      className={`mapx-node hop-${hop} ${isFocus ? "focus" : ""} ${
        isSelected ? "selected" : ""
      } ${node.status === "parked" ? "parked" : ""} ${
        isDropTarget ? "drop-target" : ""
      } ${isLinkSource ? "link-source" : ""} ${
        isLinkTarget ? "link-target" : ""
      }`}
      data-project-id={node.id}
      style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
    >
      <button
        type="button"
        className="mapx-node-label"
        onClick={() => onSelect(node.id)}
        onDoubleClick={() => onCentre(node.id)}
        title={`${node.name} — double-click to centre`}
      >
        <span className="mapx-node-name">{node.name}</span>
        {node.openTasks > 0 && (
          <span className="mapx-node-count">{node.openTasks}</span>
        )}
      </button>
      <button
        type="button"
        className="mapx-crosshair"
        title="Drag onto another project — or click, then click the other one"
        aria-label={`Connect ${node.name} to another project`}
        onPointerDown={(e) => onDragStart(e, node.id)}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        // A plain click (press and release without travelling to another node)
        // arms click-to-connect, so the connector never depends on landing a
        // drag on a small target.
        onClick={() => onStartLink(node.id)}
      >
        <CrosshairIcon />
      </button>
    </div>
  );
}

export function MapWorkspace({
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
  // Click-to-connect: the id we're drawing FROM, waiting for a target click.
  const [linkFrom, setLinkFrom] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 960, h: 600 });
  const [isFullscreen, setFullscreen] = useState(false);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  // focusId null = the overview: the whole ecosystem, connected or not. It is
  // the default, and ?focus= is the only thing that opens centred.
  const overview = focusId === null;

  // The stage owns its own pixel box; the SVG viewBox matches it 1:1 so node
  // coordinates and edge coordinates are the same numbers.
  useEffect(() => {
    const el = canvasRef.current;
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
  const targets = useMemo(
    () =>
      overview
        ? layoutOverview(nodes, edges, size)
        : layout(
            reach,
            visibleNodes.map((n) => n.id),
            size,
          ),
    [overview, nodes, edges, reach, visibleNodes, size],
  );

  // Tween node positions rather than snapping. Edges are derived from the same
  // interpolated points, so lines travel with their nodes instead of jumping a
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
  function select(id: string) {
    // Armed to connect? Then a click on any other project completes the edge
    // instead of selecting it.
    if (linkFrom && linkFrom !== id) {
      const from = linkFrom;
      setLinkFrom(null);
      void connect(from, id, "related");
      return;
    }
    if (linkFrom === id) {
      setLinkFrom(null);
      return;
    }
    setSelectedId(id);
    setSelectedEdgeId(null);
    if (!overview) setFocusId(id);
  }

  // Double-click (or the panel's button) centres from anywhere.
  function centreOn(id: string) {
    setSelectedId(id);
    setSelectedEdgeId(null);
    setFocusId(id);
  }

  // A click on the handle arms click-to-connect — unless it was the tail of a
  // real drag, which has already done the work.
  function armLink(id: string) {
    if (didDragRef.current) {
      didDragRef.current = false;
      return;
    }
    setLinkFrom(id);
  }

  // Esc backs out of an armed connection.
  useEffect(() => {
    if (!linkFrom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLinkFrom(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [linkFrom]);

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

  // ---- drag to connect ----
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [dragOrigin, setDragOrigin] = useState<Point | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  // Pointer capture means the trailing click fires on the handle even when the
  // pointer was released over another node — so a completed drag must not also
  // arm click-to-connect.
  const didDragRef = useRef(false);

  function toStage(e: React.PointerEvent): Point {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function startDrag(e: React.PointerEvent, id: string) {
    e.currentTarget.setPointerCapture(e.pointerId);
    didDragRef.current = false;
    const origin = toStage(e);
    setDragFrom(id);
    setDragOrigin(origin);
    setDragPos(origin);
  }

  function onDragMove(e: React.PointerEvent) {
    if (!dragFrom) return;
    const p = toStage(e);
    if (dragOrigin && Math.hypot(p.x - dragOrigin.x, p.y - dragOrigin.y) > 5) {
      didDragRef.current = true;
    }
    setDragPos(p);
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
    setLinkFrom(null);
    await connect(source, targetId, "related");
  }

  // ---- mutations ----
  async function connect(
    fromId: string,
    toId: string,
    kind: ProjectRelationKind,
  ) {
    try {
      const res = await fetch("/api/project-relations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fromId, toId, kind }),
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
  }

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

      {error && <p className="login-error mapx-error">{error}</p>}
      {linkFrom && (
        <p className="mapx-linking">
          Click another project to connect it to{" "}
          <strong>{nodeById.get(linkFrom)?.name}</strong>
          <button
            type="button"
            className="row-action"
            onClick={() => setLinkFrom(null)}
          >
            Cancel
          </button>
        </p>
      )}

      <div className="mapx-body">
        <div className="mapx-canvas" ref={canvasRef}>
          <svg className="mapx-svg" width={size.w} height={size.h}>
            <defs>
              <marker
                id="mapx-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M0 0 L10 5 L0 10 z" className="mapx-arrowhead" />
              </marker>
            </defs>
            {visibleEdges.map((e) => {
              const a = points.get(e.fromId);
              const b = points.get(e.toId);
              if (!a || !b) return null;
              const end = trim(a, b);
              const start = trim(b, a);
              const flow = e.kind === "blocks" || e.kind === "depends_on";
              return (
                <line
                  key={e.id}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  className={`mapx-edge kind-${e.kind} ${
                    selectedEdgeId === e.id ? "on" : ""
                  }`}
                  markerEnd={flow ? "url(#mapx-arrow)" : undefined}
                  // An SVG <line> isn't focusable on its own, so the edge
                  // editor would be mouse-only without this.
                  role="button"
                  tabIndex={0}
                  aria-label={`${nodeById.get(e.fromId)?.name} ${relationLabel(
                    e.kind,
                    "out",
                  )} ${nodeById.get(e.toId)?.name} — edit connection`}
                  onClick={() => {
                    setSelectedEdgeId((s) => (s === e.id ? null : e.id));
                  }}
                  onKeyDown={(ev) => {
                    if (ev.key === "Enter" || ev.key === " ") {
                      ev.preventDefault();
                      setSelectedEdgeId((s) => (s === e.id ? null : e.id));
                    }
                  }}
                />
              );
            })}
            {dragFrom && dragOrigin && dragPos && (
              <line
                x1={dragOrigin.x}
                y1={dragOrigin.y}
                x2={dragPos.x}
                y2={dragPos.y}
                className="mapx-drag-line"
              />
            )}
          </svg>

          {visibleNodes.map((n) => {
            const p = points.get(n.id);
            if (!p) return null;
            return (
              <Node
                key={n.id}
                node={n}
                point={p}
                hop={reach.get(n.id)?.hop ?? 0}
                isFocus={n.id === focusId}
                isSelected={n.id === selectedId}
                isDropTarget={dropTargetId === n.id}
                isLinkSource={linkFrom === n.id}
                isLinkTarget={linkFrom !== null && linkFrom !== n.id}
                onSelect={select}
                onCentre={centreOn}
                onStartLink={armLink}
                onDragStart={startDrag}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
              />
            );
          })}

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
            onStartLink={() => setLinkFrom(selected.id)}
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
      // globalThis.Node — the local `Node` here is the map's bubble component.
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
  onStartLink,
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
  onStartLink: () => void;
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
        <button type="button" className="ghost-btn ghost-btn-sm" onClick={onStartLink}>
          Draw connection
        </button>
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
