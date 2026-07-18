import { beforeEach, describe, expect, it } from "vitest";
import { search } from "@/lib/search";
import { createMeeting } from "@/lib/meetings";
import { createActionItem } from "@/lib/action-items";
import { createProject } from "@/lib/projects";
import { createNote } from "@/lib/notes";
import { makeWorkspace, resetDb } from "../helpers";

let ws: string;

beforeEach(async () => {
  await resetDb();
  ws = await makeWorkspace("Alpha", { isDefault: true });
});

describe("search", () => {
  it("finds a meeting by title (prefix match)", async () => {
    const m = await createMeeting(ws, {
      title: "Quarterly Planning",
      startTime: new Date("2026-07-10T15:00:00Z"),
    });
    const r = await search(ws, "quarter");
    expect(r.meetings.map((x) => x.id)).toContain(m.id);
  });

  it("finds an action item by content", async () => {
    const a = await createActionItem(ws, {
      content: "Follow up with the vendor",
    });
    const r = await search(ws, "vendor");
    expect(r.actions.map((x) => x.id)).toContain(a.id);
  });

  it("finds a project by name", async () => {
    const p = await createProject(ws, { name: "Billing Migration" });
    const r = await search(ws, "migration");
    expect(r.projects.map((x) => x.id)).toContain(p.id);
  });

  it("finds a note by title", async () => {
    const n = await createNote(ws, { title: "Deployment Runbook" });
    const r = await search(ws, "runbook");
    expect(r.notes.map((x) => x.id)).toContain(n.id);
  });

  it("is scoped to the workspace", async () => {
    const other = await makeWorkspace("Beta");
    await createMeeting(other, {
      title: "Secret Offsite",
      startTime: new Date("2026-07-10T15:00:00Z"),
    });
    const r = await search(ws, "offsite");
    expect(r.meetings).toHaveLength(0);
  });

  it("skips a disabled feature group", async () => {
    await createMeeting(ws, {
      title: "Roadmap review",
      startTime: new Date("2026-07-10T15:00:00Z"),
    });
    const r = await search(ws, "roadmap", { disabled: ["meetings"] });
    expect(r.meetings).toHaveLength(0);
  });

  it("returns nothing for an empty query", async () => {
    await createMeeting(ws, {
      title: "Anything",
      startTime: new Date("2026-07-10T15:00:00Z"),
    });
    const r = await search(ws, "   ");
    expect(r.meetings).toHaveLength(0);
    expect(r.actions).toHaveLength(0);
    expect(r.projects).toHaveLength(0);
    expect(r.notes).toHaveLength(0);
  });
});
