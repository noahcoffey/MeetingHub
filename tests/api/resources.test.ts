import { beforeEach, describe, expect, it } from "vitest";
import {
  GET as listMeetings,
  POST as createMeeting,
} from "@/app/api/v1/meetings/route";
import {
  GET as getMeeting,
  PATCH as patchMeeting,
} from "@/app/api/v1/meetings/[id]/route";
import {
  GET as listProjects,
  POST as createProject,
} from "@/app/api/v1/projects/route";
import {
  GET as getProject,
  PATCH as patchProject,
} from "@/app/api/v1/projects/[id]/route";
import {
  GET as listMilestones,
  POST as createMilestone,
} from "@/app/api/v1/projects/[id]/milestones/route";
import {
  GET as getMilestone,
  PATCH as patchMilestone,
} from "@/app/api/v1/milestones/[id]/route";
import { GET as listNotes, POST as createNote } from "@/app/api/v1/notes/route";
import {
  GET as getNote,
  PATCH as patchNote,
} from "@/app/api/v1/notes/[id]/route";
import { call, makeToken, makeWorkspace, resetDb } from "../helpers";

let wsA: string;
let wsB: string;
let write: string;
let read: string;

beforeEach(async () => {
  await resetDb();
  wsA = await makeWorkspace("Alpha", { isDefault: true });
  wsB = await makeWorkspace("Beta");
  write = await makeToken({ scope: "write" });
  read = await makeToken({ scope: "read" });
});

const idOf = (r: { json: Record<string, unknown> }) =>
  (r.json.item as { id: string }).id;

describe("meetings", () => {
  it("creates and reads back the full row", async () => {
    const created = await call(createMeeting, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { title: "Standup", startTime: "2026-07-17T15:00:00Z" },
    });
    expect(created.status).toBe(201);
    const res = await call(getMeeting, {
      bearer: read,
      params: { id: idOf(created) },
    });
    expect(res.status).toBe(200);
    expect((res.json.item as { title: string }).title).toBe("Standup");
  });

  it("requires a valid startTime", async () => {
    const res = await call(createMeeting, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { title: "x", startTime: "not-a-date" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects a reversed date range on list", async () => {
    const res = await call(listMeetings, {
      bearer: read,
      query: { workspace: wsA, from: "2026-08-01", to: "2026-07-01" },
    });
    expect(res.status).toBe(400);
  });

  it("writes notes last-write-wins", async () => {
    const created = await call(createMeeting, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { title: "x", startTime: "2026-07-17T15:00:00Z" },
    });
    const res = await call(patchMeeting, {
      method: "PATCH",
      bearer: write,
      params: { id: idOf(created) },
      body: { notes: "## hello" },
    });
    expect(res.status).toBe(200);
    expect((res.json.item as { notes: string }).notes).toBe("## hello");
  });
});

describe("projects and milestones", () => {
  it("creates a project, then a milestone under it", async () => {
    const proj = await call(createProject, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { name: "Launch", deadline: "2026-09-01" },
    });
    expect(proj.status).toBe(201);
    const projectId = idOf(proj);

    const ms = await call(createMilestone, {
      method: "POST",
      bearer: write,
      params: { id: projectId },
      body: { name: "Phase 1", dueDate: "2026-08-01" },
    });
    expect(ms.status).toBe(201);

    const list = await call(listMilestones, {
      bearer: read,
      params: { id: projectId },
    });
    const items = list.json.items as {
      totalTaskCount: number;
      doneTaskCount: number;
    }[];
    expect(items.length).toBe(1);
    expect(items[0].totalTaskCount).toBe(0);
  });

  it("archives a project via patch", async () => {
    const proj = await call(createProject, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { name: "Old" },
    });
    const res = await call(patchProject, {
      method: "PATCH",
      bearer: write,
      params: { id: idOf(proj) },
      body: { status: "archived" },
    });
    expect(res.status).toBe(200);
    const item = res.json.item as { status: string; archivedAt: string | null };
    expect(item.status).toBe("archived");
    expect(item.archivedAt).not.toBeNull();
  });

  it("excludes archived projects unless asked", async () => {
    const proj = await call(createProject, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { name: "Old" },
    });
    await call(patchProject, {
      method: "PATCH",
      bearer: write,
      params: { id: idOf(proj) },
      body: { status: "archived" },
    });
    const without = await call(listProjects, {
      bearer: read,
      query: { workspace: wsA },
    });
    expect((without.json.items as unknown[]).length).toBe(0);
    const withArchived = await call(listProjects, {
      bearer: read,
      query: { workspace: wsA, includeArchived: "true" },
    });
    expect((withArchived.json.items as unknown[]).length).toBe(1);
  });

  it("resolves a milestone by id through its project's workspace", async () => {
    const proj = await call(createProject, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { name: "Launch" },
    });
    const ms = await call(createMilestone, {
      method: "POST",
      bearer: write,
      params: { id: idOf(proj) },
      body: { name: "Phase 1" },
    });
    const milestoneId = idOf(ms);

    const res = await call(patchMilestone, {
      method: "PATCH",
      bearer: write,
      params: { id: milestoneId },
      body: { completed: true },
    });
    expect(res.status).toBe(200);
    expect((res.json.item as { completedAt: string | null }).completedAt).not.toBeNull();

    // A token scoped to Beta can't reach a milestone whose project is in Alpha.
    const scopedToB = await makeToken({ scope: "read", workspaceIds: [wsB] });
    const denied = await call(getMilestone, {
      bearer: scopedToB,
      params: { id: milestoneId },
    });
    expect(denied.status).toBe(404);
  });
});

describe("notes", () => {
  it("creates with a body and reads it back", async () => {
    const created = await call(createNote, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { title: "Ref", body: "the body" },
    });
    expect(created.status).toBe(201);
    expect((created.json.item as { notes: string }).notes).toBe("the body");

    const list = await call(listNotes, { bearer: read, query: { workspace: wsA } });
    expect((list.json.items as unknown[]).length).toBe(1);
  });

  it("updates title and body", async () => {
    const created = await call(createNote, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { title: "Ref" },
    });
    const res = await call(patchNote, {
      method: "PATCH",
      bearer: write,
      params: { id: idOf(created) },
      body: { title: "Ref v2", body: "updated" },
    });
    expect(res.status).toBe(200);
    const item = res.json.item as { title: string; notes: string };
    expect(item.title).toBe("Ref v2");
    expect(item.notes).toBe("updated");
  });

  it("404s a note in another workspace", async () => {
    const created = await call(createNote, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { title: "Alpha note" },
    });
    const scopedToB = await makeToken({ scope: "read", workspaceIds: [wsB] });
    const res = await call(getNote, {
      bearer: scopedToB,
      params: { id: idOf(created) },
    });
    expect(res.status).toBe(404);
  });
});
