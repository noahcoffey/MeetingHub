"use client";

import { useMemo, useRef, useState } from "react";

export type TaskNode = { id: string; content: string };
export type EnrichedEdge = {
  id: string;
  taskId: string;
  dependsOnId: string;
  dependsOnContent: string;
  dependsOnStatus: "open" | "done";
};

const CrosshairIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
    <circle cx="10" cy="10" r="6" strokeWidth="1.5" />
    <path d="M10 1.5v3M10 15.5v3M1.5 10h3M15.5 10h3" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

function truncate(s: string, max = 60): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Hoisted to module scope so it keeps a stable component identity across
// re-renders — every pointermove during a drag updates parent state, and if
// this were defined inside TaskDependenciesView, React would treat it as a new
// component type each time and remount every row (destroying the very button
// that holds pointer capture, freezing the drag mid-gesture).
function Row({
  node,
  edges,
  dependentsCount,
  dropTargetId,
  rejection,
  onRemoveEdge,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  node: TaskNode;
  edges: EnrichedEdge[];
  dependentsCount: Map<string, number>;
  dropTargetId: string | null;
  rejection: { taskId: string; message: string } | null;
  onRemoveEdge: (edgeId: string) => void;
  onDragStart: (e: React.PointerEvent, taskId: string) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: (e: React.PointerEvent) => void;
}) {
  const unmet = edges.filter((e) => e.taskId === node.id && e.dependsOnStatus !== "done");
  const blocks = dependentsCount.get(node.id) ?? 0;
  return (
    <li
      className={`dep-row ${dropTargetId === node.id ? "dep-drop-target" : ""}`}
      data-task-id={node.id}
    >
      <div className="dep-row-main">
        <span className="dep-content">{node.content}</span>
        {blocks > 0 && <span className="badge dep-blocks-badge">blocks {blocks}</span>}
        <button
          type="button"
          className="dep-crosshair"
          title="Drag to another task to set a dependency"
          aria-label="Set dependency"
          onPointerDown={(e) => onDragStart(e, node.id)}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
        >
          <CrosshairIcon />
        </button>
      </div>
      {unmet.length > 0 && (
        <ul className="dep-chips">
          {unmet.map((e) => (
            <li key={e.id} className="dep-chip">
              Blocked by: {truncate(e.dependsOnContent)}
              <button
                type="button"
                className="dep-chip-remove"
                aria-label="Remove dependency"
                onClick={() => onRemoveEdge(e.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      {rejection?.taskId === node.id && <p className="dep-reject">{rejection.message}</p>}
    </li>
  );
}

export function TaskDependenciesView({
  initialNodes,
  initialEdges,
}: {
  initialNodes: TaskNode[];
  initialEdges: EnrichedEdge[];
}) {
  const [nodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const [rejection, setRejection] = useState<{ taskId: string; message: string } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const [dragFrom, setDragFrom] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  const blockedIds = useMemo(() => {
    const s = new Set<string>();
    for (const e of edges) if (e.dependsOnStatus !== "done") s.add(e.taskId);
    return s;
  }, [edges]);

  const dependentsCount = useMemo(() => {
    const openIds = new Set(nodes.map((n) => n.id));
    const counts = new Map<string, number>();
    for (const e of edges) {
      if (!openIds.has(e.taskId)) continue;
      counts.set(e.dependsOnId, (counts.get(e.dependsOnId) ?? 0) + 1);
    }
    return counts;
  }, [edges, nodes]);

  const blocked = nodes.filter((n) => blockedIds.has(n.id));
  const ready = nodes.filter((n) => !blockedIds.has(n.id));

  async function removeEdge(edgeId: string) {
    const prev = edges;
    setEdges((es) => es.filter((e) => e.id !== edgeId));
    try {
      const res = await fetch(`/api/task-dependencies/${edgeId}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setEdges(prev);
    }
  }

  function showRejection(taskId: string, message: string) {
    setRejection({ taskId, message });
    setTimeout(() => setRejection((r) => (r?.taskId === taskId ? null : r)), 1500);
  }

  function startDrag(e: React.PointerEvent, taskId: string) {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = containerRef.current?.getBoundingClientRect();
    const origin = { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
    setDragFrom(taskId);
    setDragOrigin(origin);
    setDragPos(origin);
  }

  function onDragMove(e: React.PointerEvent) {
    if (!dragFrom) return;
    const rect = containerRef.current?.getBoundingClientRect();
    setDragPos({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) });
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const row = under?.closest<HTMLElement>("[data-task-id]");
    const id = row?.dataset.taskId ?? null;
    setDropTargetId(id && id !== dragFrom ? id : null);
  }

  async function onDragEnd(e: React.PointerEvent) {
    const source = dragFrom;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const row = under?.closest<HTMLElement>("[data-task-id]");
    const targetId = row?.dataset.taskId ?? null;
    setDragFrom(null);
    setDragPos(null);
    setDragOrigin(null);
    setDropTargetId(null);
    if (!source || !targetId || targetId === source) return;

    try {
      const res = await fetch("/api/task-dependencies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ taskId: source, dependsOnId: targetId }),
      });
      const data = await res.json();
      if (!res.ok) {
        showRejection(source, data.error ?? "Could not add dependency");
        return;
      }
      const target = nodeById.get(targetId);
      setEdges((es) => [
        ...es,
        {
          id: data.edge.id,
          taskId: source,
          dependsOnId: targetId,
          dependsOnContent: target?.content ?? "",
          dependsOnStatus: "open",
        },
      ]);
    } catch {
      showRejection(source, "Could not add dependency");
    }
  }

  return (
    <div className="dep-view" ref={containerRef}>
      {dragFrom && dragOrigin && dragPos && (
        <svg className="dep-svg" aria-hidden>
          <line
            x1={dragOrigin.x}
            y1={dragOrigin.y}
            x2={dragPos.x}
            y2={dragPos.y}
            className="dep-line"
          />
        </svg>
      )}

      {nodes.length === 0 && <p className="ai-empty">No open action items.</p>}

      {blocked.length > 0 && (
        <div className="dep-section">
          <div className="ai-group-head">
            Blocked
            <span className="count">{blocked.length}</span>
          </div>
          <ul className="dep-rows">
            {blocked.map((n) => (
              <Row
                key={n.id}
                node={n}
                edges={edges}
                dependentsCount={dependentsCount}
                dropTargetId={dropTargetId}
                rejection={rejection}
                onRemoveEdge={removeEdge}
                onDragStart={startDrag}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
              />
            ))}
          </ul>
        </div>
      )}

      {ready.length > 0 && (
        <div className="dep-section">
          <div className="ai-group-head">
            Ready
            <span className="count">{ready.length}</span>
          </div>
          <ul className="dep-rows">
            {ready.map((n) => (
              <Row
                key={n.id}
                node={n}
                edges={edges}
                dependentsCount={dependentsCount}
                dropTargetId={dropTargetId}
                rejection={rejection}
                onRemoveEdge={removeEdge}
                onDragStart={startDrag}
                onDragMove={onDragMove}
                onDragEnd={onDragEnd}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
