"use client";

import { memo, useCallback, useEffect, useState } from "react";
import {
  BaseEdge,
  Handle,
  Position,
  useInternalNode,
  useStoreApi,
  type EdgeProps,
  type EdgeTypes,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnConnectStart,
  type OnConnectEnd,
} from "@xyflow/react";
import type { ProjectRelationKind } from "@/db/schema";
import { GRAPH_STATES, GRAPH_STATE_LABEL, type ProjectGraphState } from "./project-graph-state";
import { relationLabel } from "./relation-kinds";

// Both graph surfaces (/map and the project hub's Map tab) render through these
// two components, so a project bubble and a relation line look and behave the
// same wherever they appear. React Flow owns hit-testing, panning and the
// connection gesture; the app still owns where nodes go — positions are passed
// in as controlled state, never simulated.

export const ARROW_MARKER_ID = "pg-arrow";

// Fallback bubble geometry, used only for the first frame before React Flow has
// measured the node. Bubbles are circles now, so the edge trim below is an
// ellipse with equal axes — but it stays written as an ellipse because the
// measured size is what's actually used, and a faded/overview node is smaller.
const FALLBACK_W = 126;
const FALLBACK_H = 126;

export type ProjectNodeData = {
  name: string;
  state: ProjectGraphState;
  /** Open-task count; hidden when 0 or null. */
  badge: number | null;
  /** Centre of a focused radial view — the project everything else hangs off. */
  isCentre: boolean;
  /** Two-hops-out in the focus view; drawn dimmer. */
  isFaded: boolean;
  /** Selected — carried in `data`, deliberately NOT React Flow's `selected`.
   *  Flipping React Flow's own selection re-creates the node's internals, and
   *  it renders un-hittable for that frame — which silently eats the second
   *  click of a double-click. */
  isSelected: boolean;
};

export type ProjectGraphNodeType = Node<ProjectNodeData, "project">;

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

function ProjectGraphNodeInner({ data }: NodeProps<ProjectGraphNodeType>) {
  return (
    <div
      className={`pg-node state-${data.state} ${data.isCentre ? "centre" : ""} ${
        data.isFaded ? "faded" : ""
      } ${data.isSelected ? "selected" : ""}`}
      title={`${data.name} — ${GRAPH_STATE_LABEL[data.state]}`}
    >
      {/* The whole bubble is the drop zone. React Flow keeps a handle at
          `pointer-events: none` until a connection is actually in flight (the
          `connectionindicator` class), so this covering handle catches the drop
          — or the second click of a click-to-connect — without stealing the
          ordinary clicks that select a project. `isConnectableStart={false}` is
          what keeps it out of the idle state. */}
      <Handle
        type="target"
        position={Position.Left}
        className="pg-node-hit"
        isConnectableStart={false}
      />
      <span className="pg-node-name">{data.name}</span>
      {data.badge !== null && data.badge > 0 && (
        <span className="pg-node-count">{data.badge}</span>
      )}
      {/* The visible connector. Dragging it draws a line; a plain click arms
          click-to-connect, which React Flow provides via `connectOnClick`. */}
      <Handle
        type="source"
        position={Position.Right}
        className="pg-node-crosshair"
        isConnectableEnd={false}
        title="Drag onto another project — or click, then click the other one"
      >
        <CrosshairIcon />
      </Handle>
    </div>
  );
}

export const ProjectGraphNode = memo(ProjectGraphNodeInner);
ProjectGraphNode.displayName = "ProjectGraphNode";

export type ProjectEdgeData = {
  kind: ProjectRelationKind;
  fromName: string;
  toName: string;
  /** Opens the edge editor. Keyboard activation needs it on the element itself. */
  onActivate: (id: string) => void;
};

export type ProjectGraphEdgeType = {
  id: string;
  source: string;
  target: string;
  data: ProjectEdgeData;
};

// Where a line should stop so it meets the bubble's edge rather than running
// under the label.
function trimToEllipse(
  from: { x: number; y: number },
  to: { x: number; y: number },
  rx: number,
  ry: number,
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const by = Math.min(len / 2, 1 / Math.hypot(ux / rx, uy / ry));
  return { x: to.x - ux * by, y: to.y - uy * by };
}

// Centre point and half-extents of a node as React Flow currently has it
// positioned — read live so the line follows a tweened node frame by frame.
function boxOf(node: ReturnType<typeof useInternalNode>) {
  if (!node) return null;
  const w = node.measured?.width ?? FALLBACK_W;
  const h = node.measured?.height ?? FALLBACK_H;
  return {
    x: node.internals.positionAbsolute.x + w / 2,
    y: node.internals.positionAbsolute.y + h / 2,
    rx: w / 2,
    ry: h / 2,
  };
}

function ProjectGraphEdgeInner({ id, source, target, data, selected }: EdgeProps) {
  const sourceNode = useInternalNode(source);
  const targetNode = useInternalNode(target);
  const a = boxOf(sourceNode);
  const b = boxOf(targetNode);
  if (!a || !b || !data) return null;
  const d = data as ProjectEdgeData;

  const end = trimToEllipse(a, b, b.rx, b.ry);
  const start = trimToEllipse(b, a, a.rx, a.ry);
  // Only the two directional kinds get an arrowhead; `related` is mutual and
  // `spun_from` is history, not flow.
  const flow = d.kind === "blocks" || d.kind === "depends_on";

  return (
    <BaseEdge
      id={id}
      path={`M${start.x},${start.y} L${end.x},${end.y}`}
      className={`pg-edge kind-${d.kind} ${selected ? "on" : ""}`}
      markerEnd={flow ? `url(#${ARROW_MARKER_ID})` : undefined}
      // A path takes no focus of its own, so without these the edge editor
      // would be mouse-only.
      role="button"
      tabIndex={0}
      aria-label={`${d.fromName} ${relationLabel(d.kind, "out")} ${d.toName} — edit connection`}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          d.onActivate(id);
        }
      }}
      interactionWidth={18}
    />
  );
}

export const ProjectGraphEdge = memo(ProjectGraphEdgeInner);
ProjectGraphEdge.displayName = "ProjectGraphEdge";

// Module constants, not inline object literals: a fresh object each render
// makes React Flow re-register the types and warn.
export const nodeTypes: NodeTypes = { project: ProjectGraphNode };
export const edgeTypes: EdgeTypes = { project: ProjectGraphEdge };

// The arrowhead lives in a detached SVG so both surfaces can reference it by id
// from inside React Flow's own SVG — marker ids resolve document-wide.
export function GraphDefs() {
  return (
    <svg className="pg-defs" aria-hidden focusable="false">
      <defs>
        <marker
          id={ARROW_MARKER_ID}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" className="pg-arrowhead" />
        </marker>
      </defs>
    </svg>
  );
}

// Click-to-connect: click the crosshair, then click the other project. React
// Flow drives the gesture, but it keeps the armed source in an internal store
// field that nothing clears except clicking a second handle — no Escape, no
// cancel on a pane click. So the way *out* is ours to provide, and so is
// telling the user they're armed at all.
export function useClickConnect() {
  const store = useStoreApi();
  const [armedFrom, setArmedFrom] = useState<string | null>(null);

  const cancel = useCallback(() => {
    store.setState({ connectionClickStartHandle: null });
    setArmedFrom(null);
  }, [store]);

  useEffect(() => {
    if (!armedFrom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [armedFrom, cancel]);

  const onClickConnectStart = useCallback<OnConnectStart>((_, params) => {
    setArmedFrom(params.nodeId);
  }, []);
  const onClickConnectEnd = useCallback<OnConnectEnd>(() => {
    setArmedFrom(null);
  }, []);

  return { armedFrom, cancel, onClickConnectStart, onClickConnectEnd };
}

// The armed-connection banner. Without it "click the crosshair" is a mode with
// no visible state and no way back.
export function ConnectBanner({
  name,
  onCancel,
}: {
  name: string;
  onCancel: () => void;
}) {
  return (
    <p className="pg-linking">
      Click another project to connect it to <strong>{name}</strong>
      <button type="button" className="row-action" onClick={onCancel}>
        Cancel
      </button>
    </p>
  );
}

// Legend for the bubble fills. Shown on both surfaces so the colours are never
// something you have to work out.
export function GraphLegend({ className }: { className?: string }) {
  return (
    <ul className={`pg-legend ${className ?? ""}`}>
      {GRAPH_STATES.map((s) => (
        <li key={s} className="pg-legend-item">
          <span className={`pg-legend-dot state-${s}`} aria-hidden />
          {GRAPH_STATE_LABEL[s]}
        </li>
      ))}
    </ul>
  );
}
