import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createWorkspace,
  deleteWorkspace,
  listWorkspaces,
} from "@/lib/workspaces";
import { createActionItem } from "@/lib/action-items";
import { listStats } from "@/lib/journal-stats";
import { makeWorkspace, resetDb } from "../helpers";

beforeEach(async () => {
  await resetDb();
  // Every scenario needs a default so the guards can distinguish it.
  await makeWorkspace("Default", { isDefault: true });
});

describe("deleteWorkspace guard", () => {
  it("refuses the default workspace", async () => {
    const [def] = await listWorkspaces();
    expect(await deleteWorkspace(def.id)).toEqual({
      ok: false,
      reason: "default",
    });
  });

  it("refuses a non-empty workspace and reports what's inside", async () => {
    const ws = await makeWorkspace("Work");
    await createActionItem(ws, { content: "a task" });
    const res = await deleteWorkspace(ws);
    expect(res.ok).toBe(false);
    if (res.ok || res.reason !== "not-empty") throw new Error("expected not-empty");
    expect(res.counts.actionItems).toBe(1);
    expect(res.counts.total).toBe(1);
  });

  it("deletes an empty, non-default workspace", async () => {
    const ws = await makeWorkspace("Empty");
    expect(await deleteWorkspace(ws)).toEqual({ ok: true });
    expect((await listWorkspaces()).find((w) => w.id === ws)).toBeUndefined();
  });

  it("reports not-found for an unknown id", async () => {
    expect(await deleteWorkspace(randomUUID())).toEqual({
      ok: false,
      reason: "not-found",
    });
  });
});

describe("createWorkspace", () => {
  it("seeds the four default journal stats", async () => {
    const ws = await createWorkspace("New Area");
    const stats = await listStats(ws.id);
    expect(stats.map((s) => s.name)).toEqual([
      "Productivity",
      "Anxiety",
      "Wins",
      "Learnings",
    ]);
  });
});
