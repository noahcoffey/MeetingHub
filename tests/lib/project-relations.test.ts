import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  addRelation,
  captureRelatedProject,
  countRelationsForProject,
  getProjectMap,
  getWorkspaceMap,
  listRelationEdges,
  listRelationsForProject,
  removeRelation,
  updateRelation,
} from "@/lib/project-relations";
import { createProject, listProjects, updateProject } from "@/lib/projects";
import { createMeeting } from "@/lib/meetings";
import { db } from "@/db";
import { projectRelations } from "@/db/schema";
import { makeWorkspace, resetDb } from "../helpers";

let ws: string;
let other: string;

beforeEach(async () => {
  await resetDb();
  ws = await makeWorkspace("Alpha", { isDefault: true });
  other = await makeWorkspace("Beta");
});

async function project(workspaceId: string, name: string): Promise<string> {
  const p = await createProject(workspaceId, { name });
  return p.id;
}

describe("addRelation", () => {
  it("adds an edge between two projects in the same workspace", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const res = await addRelation({ fromId: a, toId: b });
    expect(res.ok).toBe(true);
    const edges = await listRelationEdges(ws);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ fromId: a, toId: b, kind: "related" });
  });

  it("rejects a self-relation", async () => {
    const a = await project(ws, "A");
    expect(await addRelation({ fromId: a, toId: a })).toEqual({
      ok: false,
      reason: "self",
    });
  });

  it("rejects when an endpoint doesn't exist", async () => {
    const a = await project(ws, "A");
    expect(await addRelation({ fromId: a, toId: randomUUID() })).toEqual({
      ok: false,
      reason: "not-found",
    });
  });

  it("rejects a duplicate edge", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    await addRelation({ fromId: a, toId: b });
    expect(await addRelation({ fromId: a, toId: b })).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("rejects a reverse-direction edge as a duplicate", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    await addRelation({ fromId: a, toId: b });
    // One line per pair regardless of which way it was drawn — direction and
    // kind changes go through updateRelation instead.
    expect(await addRelation({ fromId: b, toId: a, kind: "blocks" })).toEqual({
      ok: false,
      reason: "duplicate",
    });
  });

  it("rejects a cross-workspace edge", async () => {
    const a = await project(ws, "A");
    const foreign = await project(other, "Foreign");
    expect(await addRelation({ fromId: a, toId: foreign })).toEqual({
      ok: false,
      reason: "cross-workspace",
    });
  });

  it("rejects a blocks edge that would close a cycle", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const c = await project(ws, "C");
    expect((await addRelation({ fromId: a, toId: b, kind: "blocks" })).ok).toBe(
      true,
    );
    expect((await addRelation({ fromId: b, toId: c, kind: "blocks" })).ok).toBe(
      true,
    );
    expect(await addRelation({ fromId: c, toId: a, kind: "blocks" })).toEqual({
      ok: false,
      reason: "cycle",
    });
  });

  it("normalizes depends_on against blocks when checking cycles", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const c = await project(ws, "C");
    // a blocks b, and c depends on b's blocker... expressed the other way:
    // blocks(a,b) is the arrow a->b; depends_on(c,b) is the arrow b->c.
    expect((await addRelation({ fromId: a, toId: b, kind: "blocks" })).ok).toBe(
      true,
    );
    expect(
      (await addRelation({ fromId: c, toId: b, kind: "depends_on" })).ok,
    ).toBe(true);
    // Now a->b->c exists; depends_on(a,c) is the arrow c->a, closing the loop.
    expect(
      await addRelation({ fromId: a, toId: c, kind: "depends_on" }),
    ).toEqual({ ok: false, reason: "cycle" });
  });

  it("allows a mutual related pair across two projects", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const c = await project(ws, "C");
    // "related" is unconstrained: a loop of related edges is meaningful.
    expect((await addRelation({ fromId: a, toId: b })).ok).toBe(true);
    expect((await addRelation({ fromId: b, toId: c })).ok).toBe(true);
    expect((await addRelation({ fromId: c, toId: a })).ok).toBe(true);
  });
});

describe("updateRelation", () => {
  it("changes an edge's kind", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const created = await addRelation({ fromId: a, toId: b });
    if (!created.ok) throw new Error("setup failed");
    const res = await updateRelation(created.relation.id, { kind: "blocks" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.relation.kind).toBe("blocks");
  });

  it("does not trip over its own arrow when retyping", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const created = await addRelation({ fromId: a, toId: b, kind: "blocks" });
    if (!created.ok) throw new Error("setup failed");
    // Retyping blocks -> depends_on flips the arrow; the edge's OLD arrow must
    // be excluded from the cycle check or this would falsely report a cycle.
    const res = await updateRelation(created.relation.id, {
      kind: "depends_on",
    });
    expect(res.ok).toBe(true);
  });

  it("rejects a retype that would close a cycle", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const c = await project(ws, "C");
    await addRelation({ fromId: a, toId: b, kind: "blocks" });
    await addRelation({ fromId: b, toId: c, kind: "blocks" });
    const loose = await addRelation({ fromId: c, toId: a });
    if (!loose.ok) throw new Error("setup failed");
    expect(await updateRelation(loose.relation.id, { kind: "blocks" })).toEqual({
      ok: false,
      reason: "cycle",
    });
  });
});

describe("listRelationEdges", () => {
  it("is scoped to the workspace", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    await addRelation({ fromId: a, toId: b });
    const x = await project(other, "X");
    const y = await project(other, "Y");
    await addRelation({ fromId: x, toId: y });
    expect(await listRelationEdges(ws)).toHaveLength(1);
    expect(await listRelationEdges(other)).toHaveLength(1);
  });
});

describe("listRelationsForProject", () => {
  it("returns edges in both directions with the other end's details", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const c = await project(ws, "C");
    await addRelation({ fromId: a, toId: b });
    await addRelation({ fromId: c, toId: a, kind: "blocks" });
    const rows = await listRelationsForProject(a);
    expect(rows).toHaveLength(2);
    const out = rows.find((r) => r.direction === "out");
    const incoming = rows.find((r) => r.direction === "in");
    expect(out?.otherId).toBe(b);
    expect(out?.otherName).toBe("B");
    expect(incoming?.otherId).toBe(c);
    expect(incoming?.kind).toBe("blocks");
  });

  it("carries the provenance meeting's title", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const meeting = await createMeeting(ws, {
      title: "Integration sync",
      startTime: new Date("2026-08-12T15:00:00Z"),
    });
    await addRelation({ fromId: a, toId: b, createdInMeetingId: meeting.id });
    const [row] = await listRelationsForProject(a);
    expect(row.createdInMeetingTitle).toBe("Integration sync");
  });
});

describe("removeRelation", () => {
  it("deletes an edge", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const res = await addRelation({ fromId: a, toId: b });
    if (!res.ok) throw new Error("setup failed");
    await removeRelation(res.relation.id);
    expect(await listRelationEdges(ws)).toHaveLength(0);
  });
});

describe("getProjectMap", () => {
  it("returns one hop by default and two on request", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const c = await project(ws, "C");
    await addRelation({ fromId: a, toId: b });
    await addRelation({ fromId: b, toId: c });

    const oneHop = await getProjectMap(a);
    expect(oneHop?.nodes.map((n) => n.id).sort()).toEqual([a, b].sort());
    expect(oneHop?.edges).toHaveLength(1);

    const twoHops = await getProjectMap(a, { depth: 2 });
    expect(twoHops?.nodes).toHaveLength(3);
    expect(twoHops?.edges).toHaveLength(2);
    expect(twoHops?.nodes.find((n) => n.id === c)?.hop).toBe(2);
  });

  it("returns null for an unknown project", async () => {
    expect(await getProjectMap(randomUUID())).toBeNull();
  });
});

describe("countRelationsForProject", () => {
  it("counts edges in both directions", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const c = await project(ws, "C");
    await addRelation({ fromId: a, toId: b });
    await addRelation({ fromId: c, toId: a });
    expect(await countRelationsForProject(a)).toBe(2);
    expect(await countRelationsForProject(b)).toBe(1);
  });
});

describe("captureRelatedProject", () => {
  it("creates a parked project and its edge in one go", async () => {
    const a = await project(ws, "A");
    const meeting = await createMeeting(ws, {
      title: "Vendor review",
      startTime: new Date("2026-08-12T15:00:00Z"),
    });
    const res = await captureRelatedProject({
      fromProjectId: a,
      name: "Payments integration rework",
      meetingId: meeting.id,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const parked = await listProjects(ws, { includeParked: true });
    const created = parked.find((p) => p.id === res.project.id);
    expect(created?.status).toBe("parked");
    expect(created?.workspaceId).toBe(ws);

    const [edge] = await listRelationsForProject(a);
    expect(edge.otherId).toBe(res.project.id);
    expect(edge.createdInMeetingId).toBe(meeting.id);
  });

  it("rejects a meeting from a different workspace", async () => {
    const a = await project(ws, "A");
    const foreignMeeting = await createMeeting(other, {
      title: "Elsewhere",
      startTime: new Date("2026-08-12T15:00:00Z"),
    });
    expect(
      await captureRelatedProject({
        fromProjectId: a,
        name: "Should not exist",
        meetingId: foreignMeeting.id,
      }),
    ).toEqual({ ok: false, reason: "bad-meeting" });
    // And nothing was created.
    expect(await listProjects(ws, { includeParked: true })).toHaveLength(1);
  });

  it("rejects an unknown source project", async () => {
    expect(
      await captureRelatedProject({
        fromProjectId: randomUUID(),
        name: "Orphan",
      }),
    ).toEqual({ ok: false, reason: "not-found" });
  });
});

describe("getWorkspaceMap", () => {
  it("returns the workspace's projects and edges, excluding archived", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const archived = await createProject(ws, { name: "Old" });
    await updateProject(archived.id, { status: "archived" });
    await addRelation({ fromId: a, toId: b });
    // An edge whose endpoint is archived must not draw an arrow into nothing.
    await addRelation({ fromId: a, toId: archived.id });
    // Another workspace's graph stays out of it entirely.
    const x = await project(other, "X");
    const y = await project(other, "Y");
    await addRelation({ fromId: x, toId: y });

    const map = await getWorkspaceMap(ws);
    expect(map.nodes.map((n) => n.name).sort()).toEqual(["A", "B"]);
    expect(map.edges).toHaveLength(1);
    expect(map.edges[0]).toMatchObject({ fromId: a, toId: b });
  });

  it("includes parked projects", async () => {
    await createProject(ws, { name: "Idea", status: "parked" });
    const map = await getWorkspaceMap(ws);
    expect(map.nodes.map((n) => n.name)).toContain("Idea");
  });
});

describe("database-level pair guards (migration 0038)", () => {
  it("rejects a mirrored edge even when the lib checks are bypassed", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    const created = await addRelation({ fromId: a, toId: b });
    expect(created.ok).toBe(true);
    // Straight to the table: two racing requests can both clear addRelation's
    // in-memory dedupe, so the unordered-pair index is the real guarantee.
    await expect(
      db.insert(projectRelations).values({ fromId: b, toId: a }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("rejects a self-edge at the database boundary", async () => {
    const a = await project(ws, "A");
    await expect(
      db.insert(projectRelations).values({ fromId: a, toId: a }),
    ).rejects.toMatchObject({ cause: { code: "23514" } });
  });

  it("reports a lost insert race as a duplicate, not a crash", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    // Both calls read the same (empty) edge list before either inserts — the
    // exact window the in-memory dedupe can't close. One wins; the other must
    // come back with a reason rather than throwing a 500 at the route.
    const [first, second] = await Promise.all([
      addRelation({ fromId: a, toId: b }),
      addRelation({ fromId: b, toId: a }),
    ]);
    const results = [first, second];
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([
      { ok: false, reason: "duplicate" },
    ]);
    expect(await listRelationEdges(ws)).toHaveLength(1);
  });
});

describe("captureRelatedProject is atomic", () => {
  it("leaves no parked project behind when the edge fails", async () => {
    const a = await project(ws, "A");
    const b = await project(ws, "B");
    await addRelation({ fromId: a, toId: b });
    const before = (await listProjects(ws, { includeParked: true })).length;
    // Name the new idea, but force the edge to fail by reusing a connected
    // pair is impossible here (the new project is fresh), so drive the failure
    // through a bad meeting instead — the project insert must roll back.
    const res = await captureRelatedProject({
      fromProjectId: a,
      name: "Should not survive",
      meetingId: randomUUID(),
    });
    expect(res).toEqual({ ok: false, reason: "bad-meeting" });
    expect((await listProjects(ws, { includeParked: true })).length).toBe(before);
  });
});
