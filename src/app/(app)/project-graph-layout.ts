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

// Every ordering below breaks ties on id after name. Project names are not
// unique, so name alone leaves the order down to whatever sequence the rows and
// edges arrived in — and the board would then shift between reloads for reasons
// nobody can see.
function byNameThenId(nameOf: (id: string) => string) {
  return (a: string, b: string) => nameOf(a).localeCompare(nameOf(b)) || a.localeCompare(b);
}

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
  const order = byNameThenId((id) => byId.get(id)?.name ?? "");
  const out = new Map<string, string[]>();
  for (const [id, set] of adj) out.set(id, [...set].sort(order));
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
  // Keyed on the component's own smallest id rather than whichever node the BFS
  // happened to start from, so shelf order doesn't depend on row order.
  const key = (ids: string[]) => [...ids].sort()[0];
  const order = byNameThenId((id) => byId.get(id)?.name ?? "");
  groups.sort((a, b) => b.length - a.length || order(key(a), key(b)));
  return groups;
}

// The node a component should be built around: most connections, then name.
export function rootOf(
  ids: string[],
  adj: Map<string, string[]>,
  nameOf: (id: string) => string,
): string {
  const order = byNameThenId(nameOf);
  return [...ids].sort(
    (a, b) => (adj.get(b)?.length ?? 0) - (adj.get(a)?.length ?? 0) || order(a, b),
  )[0];
}

/** Spacing overrides, so the style palette can retune the board live. */
export type Spacing = { ringGap?: number; squash?: number };

// How components and unconnected projects are arranged relative to each other.
// The radial tree *inside* a component is the same either way — this is only
// about where each constellation lands on the board.
export type Arrangement =
  | "scatter" // golden-angle spiral: nothing lines up
  | "shelf"; // packed rows, biggest first

export type LayoutOptions = Spacing & { arrangement?: Arrangement };

// Bubble geometry the spacing is derived from (`--pg-size` in globals.css).
const NODE_DIAMETER = 126;
const NODE_HALF = 66;
// Arc length one sibling needs on its ring: a bubble plus a little air.
const MIN_SIBLING_PITCH = NODE_DIAMETER + 22;
const ITEM_GAP = 26;

// ~137.5°, the golden angle. Because it is irrational with respect to a full
// turn, no two items ever share a spoke out from the centre, and the sequence
// of directions never repeats — so the regular rows and columns of a grid don't
// form. It is a strong tendency, not a proof about screen coordinates: two
// items on different spokes can still happen to share an x or a y. Same maths a
// sunflower head uses to pack seeds without lining any of them up.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

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
      angle.set(k, cursor + share / 2);
      wedge.set(k, share);
      cursor += share;
    }
  }

  // Ring radius per depth. A fixed `depth * ringGap` crams a busy ring: a
  // project with thirty direct relations gives each of them a sliver of angle,
  // and at a fixed radius the bubbles overlap. Arc length is wedge × radius, so
  // push the ring out until the thinnest wedge on it is worth a whole bubble.
  // Rings stay monotonic so a child never lands inside its parent's ring.
  const maxDepth = Math.max(...[...depth.values()], 0);
  const radiusAt: number[] = [0];
  for (let d = 1; d <= maxDepth; d++) {
    const onRing = order.filter((id) => depth.get(id) === d);
    const thinnest = onRing.reduce(
      (min, id) => Math.min(min, wedge.get(id) ?? Math.PI * 2),
      Math.PI * 2,
    );
    const needed = thinnest > 0 ? MIN_SIBLING_PITCH / thinnest : 0;
    radiusAt[d] = Math.max(d * ringGap, needed, radiusAt[d - 1] + ringGap * 0.6);
  }

  const points = new Map<string, Point>([[rootId, { x: 0, y: 0 }]]);
  for (const id of order) {
    if (id === rootId) continue;
    const a = angle.get(id) ?? 0;
    const r = radiusAt[depth.get(id) ?? 1] ?? ringGap;
    points.set(id, { x: Math.cos(a) * r, y: Math.sin(a) * r * squash });
  }

  let halfW = 0;
  let halfH = 0;
  for (const p of points.values()) {
    halfW = Math.max(halfW, Math.abs(p.x));
    halfH = Math.max(halfH, Math.abs(p.y));
  }
  return { points, halfW, halfH };
}

type Placed = { key: string; tree: TreeLayout };

// Radius of the circle a component needs, measured from its own centre.
function extentOf(item: Placed): number {
  return Math.hypot(item.tree.halfW, item.tree.halfH) + NODE_HALF + ITEM_GAP;
}

// Golden-angle scatter. Each component (a lone project is just a component of
// one) goes on a phyllotaxis spiral: turn ~137.5° and step out by √i. Every item
// gets its own direction out from the centre and the sequence never repeats, so
// the board stops resolving into the rows and columns that were the complaint.
// Busiest constellations sort first so they land near the middle and the loose
// projects drift outward.
//
// The spiral gives an even *density*, not clearance, so a big constellation can
// still overlap a neighbour. Each item is nudged further out along its own
// angle until it clears everything already placed, which keeps the arrangement
// deterministic — no relaxation pass, no simulation.
function arrangeScatter(
  items: Placed[],
  size: { w: number; h: number },
): Map<string, Point> {
  const out = new Map<string, Point>();
  if (items.length === 0) return out;

  const sorted = [...items].sort(
    (a, b) =>
      b.tree.points.size - a.tree.points.size ||
      extentOf(b) - extentOf(a) ||
      a.key.localeCompare(b.key),
  );

  const radii = sorted.map(extentOf);
  const step = (radii.reduce((t, r) => t + r, 0) / radii.length) * 1.55;
  // Stages are wider than they are tall, so the spiral is flattened to match
  // rather than leaving the board's left and right thirds empty.
  const squashY = Math.min(1, Math.max(0.62, size.h / Math.max(size.w, 1)));

  const settled: { x: number; y: number; r: number }[] = [];
  sorted.forEach((item, i) => {
    const angle = i * GOLDEN_ANGLE;
    const at = (radius: number) => ({
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius * squashY,
    });
    const clashes = (p: Point) =>
      settled.some((s) => Math.hypot(s.x - p.x, s.y - p.y) < s.r + radii[i]);

    let r = step * Math.sqrt(i);
    let point = at(r);
    // Creep outward in small steps first, which keeps the packing tight.
    for (let guard = 0; guard < 400 && clashes(point); guard++) {
      r += step * 0.12;
      point = at(r);
    }
    if (clashes(point)) {
      // Stepping can run out on a pathological graph — one enormous
      // constellation and a crowd of singletons makes `step` far smaller than
      // the big tree's extent. Rather than place an overlapping bubble, jump
      // straight to a radius that provably clears everything: past the furthest
      // settled centre plus both radii. Dividing by the squash accounts for the
      // flattened spiral, where the shortest distance from the origin is
      // `r * squashY`.
      const reach = settled.reduce(
        (max, s) => Math.max(max, Math.hypot(s.x, s.y) + s.r),
        0,
      );
      r = (reach + radii[i]) / squashY + 1;
      point = at(r);
    }
    const { x, y } = point;
    settled.push({ x, y, r: radii[i] });
    for (const [id, p] of item.tree.points) {
      out.set(id, { x: x + p.x, y: y + p.y });
    }
  });

  return out;
}

// Packed rows: clusters shelved biggest-first, loose projects in a band
// underneath. Kept because it is compact and predictable, but everything in it
// lines up, which is what makes a busy board read as a spreadsheet.
function arrangeShelf(
  clusters: Placed[],
  singles: string[],
  size: { w: number; h: number },
): Map<string, Point> {
  const out = new Map<string, Point>();
  let cursorX = 0;
  let rowTop = 0;
  let rowH = 0;
  const rows: { items: Placed[]; top: number; h: number; w: number }[] = [];
  let row: Placed[] = [];
  const placements = new Map<string, Point>();
  for (const item of clusters) {
    const w = item.tree.halfW * 2 + CLUSTER_PAD_X * 2;
    const h = item.tree.halfH * 2 + CLUSTER_PAD_Y * 2;
    if (row.length > 0 && cursorX + w > size.w) {
      rows.push({ items: row, top: rowTop, h: rowH, w: cursorX });
      rowTop += rowH;
      cursorX = 0;
      rowH = 0;
      row = [];
    }
    placements.set(item.key, { x: cursorX + w / 2, y: rowTop + h / 2 });
    cursorX += w;
    rowH = Math.max(rowH, h);
    row.push(item);
  }
  if (row.length > 0) {
    rows.push({ items: row, top: rowTop, h: rowH, w: cursorX });
  }

  for (const r of rows) {
    const shiftX = (size.w - r.w) / 2;
    for (const item of r.items) {
      const at = placements.get(item.key);
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
  return out;
}

// The whole workspace on one board.
export function layoutOverview(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  size: { w: number; h: number },
  opts: LayoutOptions = {},
): Map<string, Point> {
  if (nodes.length === 0) return new Map<string, Point>();

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const nameOf = (id: string) => byId.get(id)?.name ?? "";
  const adj = adjacencyOf(nodes, edges);
  const groups = componentsOf(nodes, adj);

  // Keyed on the component's own smallest id, so ordering never depends on
  // which node its BFS happened to start from.
  const laid: Placed[] = groups.map((ids) => ({
    key: [...ids].sort()[0],
    tree:
      ids.length > 1
        ? radialTree(rootOf(ids, adj, nameOf), ids, adj, opts)
        : { points: new Map([[ids[0], { x: 0, y: 0 }]]), halfW: 0, halfH: 0 },
  }));

  const placedPoints =
    opts.arrangement === "shelf"
      ? arrangeShelf(
          laid.filter((l) => l.tree.points.size > 1),
          groups.filter((g) => g.length === 1).map((g) => g[0]),
          size,
        )
      : arrangeScatter(laid, size);

  return centreComposition(placedPoints, size);
}

// Drops a finished composition into the middle of the stage. Both axes: the
// scatter is built around the origin, and the shelf is built from the top down.
export function centreComposition(
  points: Map<string, Point>,
  size: { w: number; h: number },
): Map<string, Point> {
  if (points.size === 0) return points;
  const xs = [...points.values()].map((p) => p.x);
  const ys = [...points.values()].map((p) => p.y);
  const dx = size.w / 2 - (Math.min(...xs) + Math.max(...xs)) / 2;
  const dy = size.h / 2 - (Math.min(...ys) + Math.max(...ys)) / 2;
  const out = new Map<string, Point>();
  for (const [id, p] of points) out.set(id, { x: p.x + dx, y: p.y + dy });
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
