import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addDependency,
  listDependencyEdges,
  removeDependency,
} from "@/lib/task-dependencies";
import { createActionItem } from "@/lib/action-items";
import { makeWorkspace, resetDb } from "../helpers";

let ws: string;
let other: string;

beforeEach(async () => {
  await resetDb();
  ws = await makeWorkspace("Alpha", { isDefault: true });
  other = await makeWorkspace("Beta");
});

async function task(workspaceId: string, content: string): Promise<string> {
  const item = await createActionItem(workspaceId, { content });
  return item.id;
}

describe("addDependency", () => {
  it("adds an edge between two tasks in the same workspace", async () => {
    const a = await task(ws, "A");
    const b = await task(ws, "B");
    const res = await addDependency(a, b);
    expect(res.ok).toBe(true);
    const edges = await listDependencyEdges(ws);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ taskId: a, dependsOnId: b });
  });

  it("rejects a self-dependency", async () => {
    const a = await task(ws, "A");
    expect(await addDependency(a, a)).toEqual({ ok: false, reason: "self" });
  });

  it("rejects when an endpoint doesn't exist", async () => {
    const a = await task(ws, "A");
    expect(await addDependency(a, randomUUID())).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("rejects a duplicate edge", async () => {
    const a = await task(ws, "A");
    const b = await task(ws, "B");
    await addDependency(a, b);
    expect(await addDependency(a, b)).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("rejects an edge that would close a cycle", async () => {
    const a = await task(ws, "A");
    const b = await task(ws, "B");
    const c = await task(ws, "C");
    // a -> b -> c, then c -> a would be a cycle.
    expect((await addDependency(a, b)).ok).toBe(true);
    expect((await addDependency(b, c)).ok).toBe(true);
    expect(await addDependency(c, a)).toEqual({ ok: false, reason: "cycle" });
  });

  it("rejects a cross-workspace edge", async () => {
    const a = await task(ws, "A");
    const foreign = await task(other, "Foreign");
    expect(await addDependency(a, foreign)).toEqual({
      ok: false,
      reason: "cross-workspace",
    });
  });
});

describe("listDependencyEdges", () => {
  it("is scoped to the workspace", async () => {
    const a = await task(ws, "A");
    const b = await task(ws, "B");
    await addDependency(a, b);
    const x = await task(other, "X");
    const y = await task(other, "Y");
    await addDependency(x, y);
    expect(await listDependencyEdges(ws)).toHaveLength(1);
    expect(await listDependencyEdges(other)).toHaveLength(1);
  });
});

describe("removeDependency", () => {
  it("deletes an edge", async () => {
    const a = await task(ws, "A");
    const b = await task(ws, "B");
    const res = await addDependency(a, b);
    if (!res.ok) throw new Error("setup failed");
    await removeDependency(res.edge.id);
    expect(await listDependencyEdges(ws)).toHaveLength(0);
  });
});
