// Where the bubbles go. Pure geometry over the relation graph — no React, no
// DOM, no React Flow — so it can be unit-tested against the shapes that
// actually look wrong on screen.
//
// The rule the whole file exists to enforce: **a project sits next to whatever
// it is connected to.** The previous layout put every node of a component in
// one ring around that component's hub, which meant a node's own satellites
// were scattered around the far side of the ring and their edges crossed the
// middle as chords. Here each component is laid out as a radial *tree*: every
// node gets an angular wedge, and its children fan out inside that wedge, so a
// branch stays a branch.

export type Point = { x: number; y: number };
export type LayoutNode = { id: string; name: string };
export type LayoutEdge = { fromId: string; toId: string };

// One ring outwards. Bubbles are circles (`--pg-size` in globals.css, ~126px
// across), so unlike the old wide-and-short pills they need nearly as much
// vertical room as horizontal — hence a squash close to 1 rather than 0.6.
// These two are tuned to the node size; changing `--pg-size` means revisiting
// them.
const RING_GAP = 190;
const SQUASH = 0.88;
// A chain of only-children would otherwise inherit a zero-width wedge and stack
// on top of each other.
const MIN_WEDGE = 0.38;
// Padding around a component when components are packed onto the board — half a
// bubble plus breathing room, since a component's extent is measured to its
// outermost node's centre.
const CLUSTER_PAD_X = 90;
const CLUSTER_PAD_Y = 80;
// The loose-projects band at the bottom.
const SINGLE_PITCH_X = 150;
const SINGLE_PITCH_Y = 138;

// Neighbours in a stable order, so the same graph always draws the same way.
export function adjacencyOf(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Map<string, string[]> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const adj = new Map<string, Set<string>>();
  for (const n of nodes) adj.set(n.id, new Set());
  for (const e of edges) {
    if (!byId.has(e.fromId) || !byId.has(e.toId)) continue;
    adj.get(e.fromId)?.add(e.toId);
    adj.get(e.toId)?.add(e.fromId);
  }
  const out = new Map<string, string[]>();
  for (const [id, set] of adj) {
    out.set(
      id,
      [...set].sort((a, b) =>
        (byId.get(a)?.name ?? "").localeCompare(byId.get(b)?.name ?? ""),
      ),
    );
  }
  return out;
}

// Connected components, biggest first. Ties break on name so the board is
// stable across reloads.
export function componentsOf(
  nodes: LayoutNode[],
  adj: Map<string, string[]>,
): string[][] {
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const n of nodes) {
    if (seen.has(n.id)) continue;
    const group: string[] = [];
    const queue = [n.id];
    while (queue.length > 0) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      group.push(id);
      for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) queue.push(nb);
    }
    groups.push(group);
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  groups.sort(
    (a, b) =>
      b.length - a.length ||
      (byId.get(a[0])?.name ?? "").localeCompare(byId.get(b[0])?.name ?? ""),
  );
  return groups;
}

// The node a component should be built around: most connections, then name.
export function rootOf(
  ids: string[],
  adj: Map<string, string[]>,
  nameOf: (id: string) => string,
): string {
  return [...ids].sort(
    (a, b) =>
      (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0) ||
      nameOf(a).localeCompare(nameOf(b)),
  )[0];
}

/** Spacing overrides, so the dev style palette can retune the board live. */
export type Spacing = { ringGap?: number; squash?: number };

export type TreeLayout = {
  points: Map<string, Point>;
  /** Half-extents of what was drawn, measured from the root at (0,0). */
  halfW: number;
  halfH: number;
};

// Radial spanning tree rooted at `rootId`, centred on (0, 0).
//
// BFS gives the tree; every edge that isn't a tree edge still gets drawn, it
// just isn't what decides position. Each node owns an angular wedge and hands
// slices of it to its children in proportion to how many leaves hang off each
// one — so a heavy branch gets room and a light one doesn't waste any, and
// because a child's slice is carved out of its parent's wedge, children always
// sit on the parent's side of the board.
export function radialTree(
  rootId: string,
  ids: string[],
  adj: Map<string, string[]>,
  spacing: Spacing = {},
): TreeLayout {
  const ringGap = spacing.ringGap ?? RING_GAP;
  const squash = spacing.squash ?? SQUASH;
  const inComponent = new Set(ids);
  const parent = new Map<string, string | null>([[rootId, null]]);
  const children = new Map<string, string[]>();
  const depth = new Map<string, number>([[rootId, 0]]);
  const order: string[] = [rootId];

  for (let i = 0; i < order.length; i++) {
    const id = order[i];
    const kids: string[] = [];
    for (const nb of adj.get(id) ?? []) {
      if (!inComponent.has(nb) || parent.has(nb)) continue;
      parent.set(nb, id);
      depth.set(nb, (depth.get(id) ?? 0) + 1);
      kids.push(nb);
      order.push(nb);
    }
    children.set(id, kids);
  }

  // Leaves carried by each subtree, computed leaves-up.
  const weight = new Map<string, number>();
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i];
    const kids = children.get(id) ?? [];
    weight.set(
      id,
      kids.length === 0
        ? 1
        : kids.reduce((sum, k) => sum + (weight.get(k) ?? 1), 0),
    );
  }

  const angle = new Map<string, number>([[rootId, -Math.PI / 2]]);
  const wedge = new Map<string, number>([[rootId, Math.PI * 2]]);
  const points = new Map<string, Point>([[rootId, { x: 0, y: 0 }]]);

  for (const id of order) {
    const kids = children.get(id) ?? [];
    if (kids.length === 0) continue;
    const total = kids.reduce((sum, k) => sum + (weight.get(k) ?? 1), 0) || 1;
    let span = wedge.get(id) ?? Math.PI * 2;
    // The root owns the full circle; everyone else fans within their own slice,
    // widened a little if the slice is too thin to separate siblings at all.
    if (id !== rootId) span = Math.max(span, MIN_WEDGE * kids.length);
    const base = (angle.get(id) ?? 0) - span / 2;
    let cursor = base;
    for (const k of kids) {
      const share = (span * (weight.get(k) ?? 1)) / total;
      const a = cursor + share / 2;
      cursor += share;
      angle.set(k, a);
      wedge.set(k, share);
      const r = (depth.get(k) ?? 1) * ringGap;
      points.set(k, { x: Math.cos(a) * r, y: Math.sin(a) * r * squash });
    }
  }

  let halfW = 0;
  let halfH = 0;
  for (const p of points.values()) {
    halfW = Math.max(halfW, Math.abs(p.x));
    halfH = Math.max(halfH, Math.abs(p.y));
  }
  return { points, halfW, halfH };
}

// The whole workspace on one board: connected clusters up top, then the
// not-yet-connected projects packed into rows underneath. Clusters are packed
// by their real size rather than dropped into equal grid cells, so a pair
// doesn't get the same acreage as a twelve-project constellation.
export function layoutOverview(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  size: { w: number; h: number },
  spacing: Spacing = {},
): Map<string, Point> {
  const out = new Map<string, Point>();
  if (nodes.length === 0) return out;

  const nameOf = (id: string) =>
    nodes.find((n) => n.id === id)?.name ?? "";
  const adj = adjacencyOf(nodes, edges);
  const groups = componentsOf(nodes, adj);
  const clusters = groups.filter((g) => g.length > 1);
  const singles = groups.filter((g) => g.length === 1).map((g) => g[0]);

  const laid = clusters.map((ids) => ({
    ids,
    tree: radialTree(rootOf(ids, adj, nameOf), ids, adj, spacing),
  }));

  // Shelf-pack the clusters: fill a row until the next one won't fit, then drop
  // to a new row whose height is the tallest thing in it.
  let cursorX = 0;
  let rowTop = 0;
  let rowH = 0;
  const rows: { items: typeof laid; top: number; h: number; w: number }[] = [];
  let row: typeof laid = [];
  const placements = new Map<string, Point>(); // cluster root -> centre
  for (const item of laid) {
    const w = item.tree.halfW * 2 + CLUSTER_PAD_X * 2;
    const h = item.tree.halfH * 2 + CLUSTER_PAD_Y * 2;
    if (row.length > 0 && cursorX + w > size.w) {
      rows.push({ items: row, top: rowTop, h: rowH, w: cursorX });
      rowTop += rowH;
      cursorX = 0;
      rowH = 0;
      row = [];
    }
    placements.set(item.ids[0], {
      x: cursorX + w / 2,
      y: rowTop + h / 2,
    });
    cursorX += w;
    rowH = Math.max(rowH, h);
    row.push(item);
  }
  if (row.length > 0) rows.push({ items: row, top: rowTop, h: rowH, w: cursorX });

  // Centre each row horizontally, and each cluster vertically inside its row.
  for (const r of rows) {
    const shiftX = (size.w - r.w) / 2;
    for (const item of r.items) {
      const at = placements.get(item.ids[0]);
      if (!at) continue;
      const cx = at.x + shiftX;
      const cy = r.top + r.h / 2;
      for (const [id, p] of item.tree.points) {
        out.set(id, { x: cx + p.x, y: cy + p.y });
      }
    }
  }

  const clustersBottom = rows.reduce((t, r) => t + r.h, 0);

  if (singles.length > 0) {
    const perRow = Math.max(
      1,
      Math.min(singles.length, Math.floor(size.w / SINGLE_PITCH_X)),
    );
    singles.forEach((id, i) => {
      const rowIndex = Math.floor(i / perRow);
      const inRow = Math.min(perRow, singles.length - rowIndex * perRow);
      const gap = size.w / (inRow + 1);
      out.set(id, {
        x: gap * ((i % perRow) + 1),
        y: clustersBottom + SINGLE_PITCH_Y * (rowIndex + 1),
      });
    });
  }

  return centreVertically(out, size);
}

// Everything above is laid out from the top down; this drops the finished
// composition into the middle of the stage.
export function centreVertically(
  points: Map<string, Point>,
  size: { w: number; h: number },
): Map<string, Point> {
  const ys = [...points.values()].map((p) => p.y);
  if (ys.length === 0) return points;
  const shift = size.h / 2 - (Math.min(...ys) + Math.max(...ys)) / 2;
  const out = new Map<string, Point>();
  for (const [id, p] of points) out.set(id, { x: p.x, y: p.y + shift });
  return out;
}

// Placing ONE new node without disturbing anything already on the board. A
// captured idea always arrives with an edge, so it can simply be hung off its
// neighbour at whatever angle is least crowded — no relayout, no drift, which
// is the difference between a node appearing and the board appearing to
// reload.
export function placeNear(
  newId: string,
  anchorId: string,
  existing: Map<string, Point>,
): Point {
  const anchor = existing.get(anchorId);
  if (!anchor) {
    // No anchor on the board — drop it just below the middle of everything.
    const xs = [...existing.values()].map((p) => p.x);
    const ys = [...existing.values()].map((p) => p.y);
    if (xs.length === 0) return { x: 0, y: 0 };
    return {
      x: (Math.min(...xs) + Math.max(...xs)) / 2,
      y: Math.max(...ys) + RING_GAP * SQUASH,
    };
  }

  // Taken directions around the anchor, so the new bubble lands in a gap.
  const taken: number[] = [];
  for (const [id, p] of existing) {
    if (id === anchorId || id === newId) continue;
    const dx = p.x - anchor.x;
    const dy = (p.y - anchor.y) / SQUASH;
    if (Math.hypot(dx, dy) > RING_GAP * 1.8) continue;
    taken.push(Math.atan2(dy, dx));
  }

  let best = -Math.PI / 2;
  if (taken.length > 0) {
    // Widest gap between occupied directions, walking the circle once.
    const sorted = [...taken].sort((a, b) => a - b);
    let widest = -1;
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      const b = i === sorted.length - 1 ? sorted[0] + Math.PI * 2 : sorted[i + 1];
      if (b - a > widest) {
        widest = b - a;
        best = a + (b - a) / 2;
      }
    }
  }
  return {
    x: anchor.x + Math.cos(best) * RING_GAP,
    y: anchor.y + Math.sin(best) * RING_GAP * SQUASH,
  };
}
