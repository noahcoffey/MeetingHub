import { describe, expect, it } from "vitest";
import {
  adjacencyOf,
  componentsOf,
  layoutOverview,
  placeNear,
  radialTree,
  rootOf,
  type LayoutEdge,
  type LayoutNode,
} from "@/app/(app)/project-graph-layout";

const SIZE = { w: 1100, h: 760 };

function node(id: string): LayoutNode {
  return { id, name: id };
}
function edge(fromId: string, toId: string): LayoutEdge {
  return { fromId, toId };
}
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

// The shape that looked wrong on screen: one busy hub ("test1"), a second hub
// ("test4") hanging off it with three satellites of its own, and a handful of
// parked ideas attached only to test1. The old layout put every one of these in
// a single ring around test1, so test4's satellites sat on the far side of the
// board and their edges crossed the middle.
const NODES = [
  "test1",
  "test2",
  "test3",
  "test4",
  "parkedA",
  "parkedB",
  "parkedC",
  "leafX",
  "leafY",
  "leafZ",
].map(node);

const EDGES = [
  edge("test1", "test2"),
  edge("test1", "test4"),
  edge("test1", "parkedA"),
  edge("test1", "parkedB"),
  edge("test1", "parkedC"),
  edge("test4", "leafX"),
  edge("test4", "leafY"),
  edge("test4", "leafZ"),
];

describe("project graph layout", () => {
  it("hangs a node's satellites off that node, not off the hub", () => {
    const p = layoutOverview(NODES, EDGES, SIZE);
    const test1 = p.get("test1")!;
    const test4 = p.get("test4")!;

    // This is the complaint, stated as an assertion: every one of test4's
    // exclusive satellites must be nearer test4 than the busier hub.
    for (const leaf of ["leafX", "leafY", "leafZ"]) {
      const at = p.get(leaf)!;
      expect(dist(at, test4)).toBeLessThan(dist(at, test1));
    }
    // And symmetrically, test1's parked ideas stay with test1.
    for (const parked of ["parkedA", "parkedB", "parkedC"]) {
      const at = p.get(parked)!;
      expect(dist(at, test1)).toBeLessThan(dist(at, test4));
    }
  });

  it("keeps a branch on one side instead of spreading it round the hub", () => {
    const p = layoutOverview(NODES, EDGES, SIZE);
    const test1 = p.get("test1")!;
    const test4 = p.get("test4")!;
    // Direction from the root out to test4.
    const branch = Math.atan2(test4.y - test1.y, test4.x - test1.x);
    for (const leaf of ["leafX", "leafY", "leafZ"]) {
      const at = p.get(leaf)!;
      const a = Math.atan2(at.y - test1.y, at.x - test1.x);
      // Angle between the leaf and the branch it belongs to, normalised.
      let delta = Math.abs(a - branch) % (Math.PI * 2);
      if (delta > Math.PI) delta = Math.PI * 2 - delta;
      // Comfortably within a quadrant of its own branch — never a chord across
      // to the opposite side, which is what "> PI/2" would mean.
      expect(delta).toBeLessThan(Math.PI / 2);
    }
  });

  it("puts every node somewhere, exactly once", () => {
    const p = layoutOverview(NODES, EDGES, SIZE);
    expect(p.size).toBe(NODES.length);
    for (const n of NODES) expect(p.has(n.id)).toBe(true);
  });

  it("is deterministic — the same graph lays out the same way twice", () => {
    const a = layoutOverview(NODES, EDGES, SIZE);
    const b = layoutOverview([...NODES].reverse(), [...EDGES].reverse(), SIZE);
    for (const n of NODES) {
      expect(a.get(n.id)!.x).toBeCloseTo(b.get(n.id)!.x, 6);
      expect(a.get(n.id)!.y).toBeCloseTo(b.get(n.id)!.y, 6);
    }
  });

  // Project names are not unique, so name-only ordering would leave the board
  // at the mercy of whatever order rows and edges arrived in.
  it("is deterministic when two projects share a name", () => {
    const dupes: LayoutNode[] = [
      { id: "n1", name: "hub" },
      { id: "n2", name: "same" },
      { id: "n3", name: "same" },
      { id: "n4", name: "same" },
    ];
    const dupeEdges = [edge("n1", "n2"), edge("n1", "n3"), edge("n1", "n4")];
    const a = layoutOverview(dupes, dupeEdges, SIZE);
    // Reversing both inputs changes only arrival order, never the graph.
    const b = layoutOverview([...dupes].reverse(), [...dupeEdges].reverse(), SIZE);
    for (const n of dupes) {
      expect(a.get(n.id)!.x).toBeCloseTo(b.get(n.id)!.x, 6);
      expect(a.get(n.id)!.y).toBeCloseTo(b.get(n.id)!.y, 6);
    }
    // And the same-named siblings still land in distinct places.
    const seen = ["n2", "n3", "n4"].map((id) => a.get(id)!);
    expect(dist(seen[0], seen[1])).toBeGreaterThan(40);
    expect(dist(seen[1], seen[2])).toBeGreaterThan(40);
    expect(dist(seen[0], seen[2])).toBeGreaterThan(40);
  });

  it("picks the same root when the best-connected projects tie on name", () => {
    const tied: LayoutNode[] = [
      { id: "b", name: "tie" },
      { id: "a", name: "tie" },
      { id: "c", name: "leaf" },
      { id: "d", name: "leaf" },
    ];
    const tiedEdges = [edge("a", "c"), edge("b", "d"), edge("a", "b")];
    const adj = adjacencyOf(tied, tiedEdges);
    const [main] = componentsOf(tied, adj);
    const first = rootOf(main, adj, (id) => tied.find((n) => n.id === id)!.name);
    const reversedAdj = adjacencyOf([...tied].reverse(), [...tiedEdges].reverse());
    const [mainReversed] = componentsOf([...tied].reverse(), reversedAdj);
    const second = rootOf(mainReversed, reversedAdj, (id) => tied.find((n) => n.id === id)!.name);
    expect(first).toBe(second);
  });

  it("roots a component on its best-connected project", () => {
    const adj = adjacencyOf(NODES, EDGES);
    const [main] = componentsOf(NODES, adj);
    expect(rootOf(main, adj, (id) => id)).toBe("test1");
  });

  it("shelf mode still puts unconnected projects in a band below", () => {
    const nodes = [...NODES, node("loose1"), node("loose2")];
    const p = layoutOverview(nodes, EDGES, SIZE, { arrangement: "shelf" });
    const clusterYs = ["test1", "test4"].map((id) => p.get(id)!.y);
    expect(p.get("loose1")!.y).toBeGreaterThan(Math.max(...clusterYs));
    expect(p.get("loose2")!.y).toBeGreaterThan(Math.max(...clusterYs));
  });

  // The point of the scatter: a golden-angle spiral stops the board resolving
  // into the rows and columns that were the complaint about the packed grid.
  describe("scatter arrangement", () => {
    const LOOSE = Array.from({ length: 12 }, (_, i) => node(`loose${i}`));
    const nodes = [...NODES, ...LOOSE];

    it("places every project exactly once", () => {
      const p = layoutOverview(nodes, EDGES, SIZE);
      expect(p.size).toBe(nodes.length);
      for (const n of nodes) expect(Number.isFinite(p.get(n.id)!.x)).toBe(true);
    });

    // A heuristic, deliberately: the golden angle guarantees each item its own
    // direction out from the centre, not that no two ever share a coordinate.
    // What it rules out is the *systematic* alignment of a grid, and these
    // thresholds are far outside what the packed rows could produce — there,
    // twelve loose projects shared a handful of x values and two or three y.
    it("does not line the loose projects up into rows or columns", () => {
      const p = layoutOverview(nodes, EDGES, SIZE);
      const pts = LOOSE.map((n) => p.get(n.id)!);
      const BUCKET = 8; // px; coordinates within this count as aligned
      const xs = new Set(pts.map((q) => Math.round(q.x / BUCKET)));
      const ys = new Set(pts.map((q) => Math.round(q.y / BUCKET)));
      expect(xs.size).toBeGreaterThan(pts.length * 0.75);
      expect(ys.size).toBeGreaterThan(pts.length * 0.75);
    });

    // The guard that actually is absolute: no overlap, even when one enormous
    // constellation and a crowd of singletons pushes the stepping loop past its
    // bound and onto the provably-clear fallback radius.
    it("keeps bubbles clear even when one component dwarfs the rest", () => {
      const bigIds = Array.from({ length: 40 }, (_, i) => node(`big${i}`));
      const spokes = bigIds.slice(1).map((n) => edge("big0", n.id));
      const crowd = Array.from({ length: 25 }, (_, i) => node(`tiny${i}`));
      const p = layoutOverview([...bigIds, ...crowd], spokes, SIZE);
      expect(p.size).toBe(bigIds.length + crowd.length);
      const pts = [...p.values()];
      for (const q of pts) expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          expect(dist(pts[i], pts[j])).toBeGreaterThan(80);
        }
      }
    });

    it("keeps bubbles clear of each other", () => {
      const p = layoutOverview(nodes, EDGES, SIZE);
      const pts = [...p.values()];
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          expect(dist(pts[i], pts[j])).toBeGreaterThan(80);
        }
      }
    });

    it("is deterministic", () => {
      const a = layoutOverview(nodes, EDGES, SIZE);
      const b = layoutOverview([...nodes].reverse(), [...EDGES].reverse(), SIZE);
      for (const n of nodes) {
        expect(a.get(n.id)!.x).toBeCloseTo(b.get(n.id)!.x, 6);
        expect(a.get(n.id)!.y).toBeCloseTo(b.get(n.id)!.y, 6);
      }
    });

    it("puts the busiest constellation nearest the middle", () => {
      const p = layoutOverview(nodes, EDGES, SIZE);
      // The overview is origin-anchored so saved positions stay meaningful;
      // the viewport frames it, so "the middle" is (0, 0), not the stage centre.
      const centre = { x: 0, y: 0 };
      const hub = dist(p.get("test1")!, centre);
      for (const n of LOOSE) {
        expect(dist(p.get(n.id)!, centre)).toBeGreaterThan(hub);
      }
    });
  });

  it("lays out several components without overlapping them", () => {
    const nodes = [...NODES, node("otherHub"), node("otherLeaf")];
    const edges = [...EDGES, edge("otherHub", "otherLeaf")];
    const p = layoutOverview(nodes, edges, SIZE);
    // The second component's nodes stay closer to each other than to the first.
    const oh = p.get("otherHub")!;
    const ol = p.get("otherLeaf")!;
    expect(dist(oh, ol)).toBeLessThan(dist(oh, p.get("test1")!));
  });

  it("handles a lone project and an empty graph", () => {
    expect(layoutOverview([], [], SIZE).size).toBe(0);
    const one = layoutOverview([node("solo")], [], SIZE);
    expect(one.size).toBe(1);
    expect(Number.isFinite(one.get("solo")!.x)).toBe(true);
    expect(Number.isFinite(one.get("solo")!.y)).toBe(true);
  });

  it("a chain does not collapse onto itself", () => {
    const chain = ["a", "b", "c", "d", "e"].map(node);
    const chainEdges = [
      edge("a", "b"),
      edge("b", "c"),
      edge("c", "d"),
      edge("d", "e"),
    ];
    const p = layoutOverview(chain, chainEdges, SIZE);
    const seen: { x: number; y: number }[] = [];
    for (const n of chain) {
      const at = p.get(n.id)!;
      for (const other of seen) expect(dist(at, other)).toBeGreaterThan(40);
      seen.push(at);
    }
  });

  // Dragging a bubble persists its position, so the layout must honour it
  // exactly and work around it.
  describe("pinned positions", () => {
    it("places a pinned project exactly where it was dropped", () => {
      const pinned = new Map([["test3", { x: -900, y: 640 }]]);
      const p = layoutOverview(NODES, EDGES, SIZE, { pinned });
      expect(p.get("test3")!.x).toBeCloseTo(-900, 6);
      expect(p.get("test3")!.y).toBeCloseTo(640, 6);
    });

    it("moves a pinned project's whole constellation with it, keeping its shape", () => {
      const loose = layoutOverview(NODES, EDGES, SIZE);
      const shape = (m: Map<string, { x: number; y: number }>) =>
        dist(m.get("test1")!, m.get("test4")!);
      const pinned = new Map([["test1", { x: 1500, y: -1200 }]]);
      const p = layoutOverview(NODES, EDGES, SIZE, { pinned });
      expect(p.get("test1")!.x).toBeCloseTo(1500, 6);
      // The tree is rigid: relative geometry survives the move.
      expect(shape(p)).toBeCloseTo(shape(loose), 6);
    });

    it("keeps auto-placed projects clear of pinned ones", () => {
      const extra = Array.from({ length: 10 }, (_, i) => node(`extra${i}`));
      const pinned = new Map([["extra0", { x: 0, y: 0 }]]);
      const p = layoutOverview([...NODES, ...extra], EDGES, SIZE, { pinned });
      const at = p.get("extra0")!;
      for (const [id, q] of p) {
        if (id === "extra0") continue;
        expect(dist(at, q)).toBeGreaterThan(80);
      }
    });

    it("is deterministic with pins, and unaffected by stage size", () => {
      const pinned = new Map([["test4", { x: 400, y: -300 }]]);
      const a = layoutOverview(NODES, EDGES, SIZE, { pinned });
      // Origin-anchored: a different window must not move anything, or a saved
      // position would mean something different next session.
      const b = layoutOverview(NODES, EDGES, { w: 640, h: 2000 }, { pinned });
      for (const n of NODES) {
        expect(a.get(n.id)!.x).toBeCloseTo(b.get(n.id)!.x, 6);
        expect(a.get(n.id)!.y).toBeCloseTo(b.get(n.id)!.y, 6);
      }
    });

    it("ignores a pin for a project that no longer exists", () => {
      const pinned = new Map([["ghost", { x: 10, y: 10 }]]);
      const p = layoutOverview(NODES, EDGES, SIZE, { pinned });
      expect(p.size).toBe(NODES.length);
      expect(p.has("ghost")).toBe(false);
    });
  });

  describe("placeNear", () => {
    it("puts a new node one ring from its anchor", () => {
      const existing = new Map([["anchor", { x: 100, y: 100 }]]);
      const p = placeNear("fresh", "anchor", existing);
      const d = dist(p, { x: 100, y: 100 });
      expect(d).toBeGreaterThan(80);
      expect(d).toBeLessThan(200);
    });

    it("avoids a direction that is already occupied", () => {
      const existing = new Map([
        ["anchor", { x: 0, y: 0 }],
        // Directly above the anchor.
        ["taken", { x: 0, y: -100 }],
      ]);
      const p = placeNear("fresh", "anchor", existing);
      const taken = existing.get("taken")!;
      expect(dist(p, taken)).toBeGreaterThan(80);
    });

    it("still lands somewhere sane with no anchor on the board", () => {
      const existing = new Map([["far", { x: 10, y: 20 }]]);
      const p = placeNear("fresh", "missing", existing);
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    });
  });

  it("radialTree reaches every node in the component", () => {
    const adj = adjacencyOf(NODES, EDGES);
    const [main] = componentsOf(NODES, adj);
    const { points } = radialTree("test1", main, adj);
    expect(points.size).toBe(main.length);
    expect(points.get("test1")).toEqual({ x: 0, y: 0 });
  });
});
