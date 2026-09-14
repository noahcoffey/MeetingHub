import { beforeEach, describe, expect, it } from "vitest";
import { search } from "@/lib/search";
import { createMeeting } from "@/lib/meetings";
import { createActionItem } from "@/lib/action-items";
import { createProject } from "@/lib/projects";
import { createNote } from "@/lib/notes";
import { db } from "@/db";
import { daySummaries } from "@/db/schema";
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

describe("search: day summaries", () => {
  async function addSummary(
    workspaceId: string,
    over: Partial<{
      day: string;
      markdown: string;
      markdownEdited: string | null;
      status: "generating" | "ready" | "failed";
    }> = {},
  ) {
    const [row] = await db
      .insert(daySummaries)
      .values({
        workspaceId,
        day: over.day ?? "2026-09-14",
        markdown: over.markdown ?? "Portal planning dominated the day.",
        markdownEdited: over.markdownEdited ?? null,
        inputFingerprint: "fp",
        generatedAt: new Date(),
      })
      .returning();
    return row;
  }

  it("finds a day summary by its body and returns the day", async () => {
    const s = await addSummary(ws);
    const r = await search(ws, "portal");
    expect(r.daySummaries.map((x) => x.id)).toContain(s.id);
    expect(r.daySummaries[0].day).toBe("2026-09-14");
  });

  it("searches the hand-edited body when there is one", async () => {
    await addSummary(ws, {
      markdown: "generated wording",
      markdownEdited: "rewritten to mention escrow",
    });
    expect((await search(ws, "escrow")).daySummaries.length).toBe(1);
    expect((await search(ws, "generated")).daySummaries.length).toBe(0);
  });

  it("surfaces alongside the source meetings rather than replacing them", async () => {
    await createMeeting(ws, {
      title: "Portal working session",
      startTime: new Date("2026-09-14T15:00:00Z"),
    });
    await addSummary(ws);
    const r = await search(ws, "portal");
    expect(r.daySummaries.length).toBe(1);
    expect(r.meetings.length).toBe(1);
  });

  it("is scoped to the workspace", async () => {
    const other = await makeWorkspace("Gamma");
    await addSummary(other);
    expect((await search(ws, "portal")).daySummaries).toEqual([]);
  });

  it("is hidden when the meetings feature is off", async () => {
    await addSummary(ws);
    const r = await search(ws, "portal", { disabled: ["meetings"] });
    expect(r.daySummaries).toEqual([]);
  });
});
