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

  it("roots a component on its best-connected project", () => {
    const adj = adjacencyOf(NODES, EDGES);
    const [main] = componentsOf(NODES, adj);
    expect(rootOf(main, adj, (id) => id)).toBe("test1");
  });

  it("separates unconnected projects into their own band", () => {
    const nodes = [...NODES, node("loose1"), node("loose2")];
    const p = layoutOverview(nodes, EDGES, SIZE);
    const clusterYs = ["test1", "test4"].map((id) => p.get(id)!.y);
    // The loose band sits below the constellations.
    expect(p.get("loose1")!.y).toBeGreaterThan(Math.max(...clusterYs));
    expect(p.get("loose2")!.y).toBeGreaterThan(Math.max(...clusterYs));
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
