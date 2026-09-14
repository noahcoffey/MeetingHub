import { beforeEach, describe, expect, it } from "vitest";
import { GET as getContext } from "@/app/api/v1/day-summary-context/route";
import {
  GET as listDaySummaries,
  PUT as putDaySummary,
} from "@/app/api/v1/day-summaries/route";
import {
  GET as getDaySummary,
  PATCH as patchDaySummary,
} from "@/app/api/v1/day-summaries/[id]/route";
import { getDaySummaryView } from "@/lib/day-summaries";
import { saveMeetingNotes } from "@/lib/meetings";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { call, makeToken, makeWorkspace, resetDb } from "../helpers";

// Generation lives in tools/day-summary, so nothing here needs an LLM stub:
// these tests cover the two halves of the contract the runner talks to — the
// context it reads, and the upsert it pushes.

let wsA: string;
let wsB: string;
let write: string;
let read: string;

const DAY = "2026-09-14";

// 9:00–10:00 New York on DAY (EDT, UTC-4).
async function addMeeting(
  workspaceId: string,
  over: {
    title?: string;
    notes?: string;
    notesGenerated?: string | null;
    startTime?: Date;
    endTime?: Date | null;
    attendees?: { name?: string; email?: string }[];
    skipped?: boolean;
  } = {},
) {
  const [row] = await db
    .insert(meetings)
    .values({
      workspaceId,
      title: over.title ?? "Standup",
      startTime: over.startTime ?? new Date("2026-09-14T13:00:00Z"),
      endTime:
        over.endTime === undefined ? new Date("2026-09-14T14:00:00Z") : over.endTime,
      notes: over.notes ?? "",
      notesGenerated: over.notesGenerated ?? null,
      notesGeneratedUpdatedAt: over.notesGenerated ? new Date() : null,
      attendees: over.attendees ?? [],
      skipped: over.skipped ?? false,
    })
    .returning();
  return row;
}

beforeEach(async () => {
  await resetDb();
  wsA = await makeWorkspace("Alpha", { isDefault: true });
  wsB = await makeWorkspace("Beta");
  write = await makeToken({ scope: "write" });
  read = await makeToken({ scope: "read" });
});

const item = (r: { json: Record<string, unknown> }) =>
  r.json.item as Record<string, unknown>;

type ContextMeeting = {
  title: string;
  timeLabel: string;
  attendees: string[];
  notes: string;
  generatedSections: string;
};

async function contextFor(workspaceId: string, date = DAY, bearer = read) {
  const res = await call(getContext, {
    bearer,
    query: { workspace: workspaceId, date },
  });
  return res;
}

describe("GET /api/v1/day-summary-context", () => {
  it("returns manual notes in full and only the wanted generated sections", async () => {
    await addMeeting(wsA, {
      notes: "Atlas is the platform of record.",
      notesGenerated:
        "## Summary\nkeep me\n\n## Key Discussion Points\ndrop me\n\n## Action Items\nkeep me too",
    });
    const res = await contextFor(wsA);
    expect(res.status).toBe(200);
    const m = (item(res).meetings as ContextMeeting[])[0];
    expect(m.notes).toBe("Atlas is the platform of record.");
    expect(m.generatedSections).toContain("keep me");
    expect(m.generatedSections).toContain("keep me too");
    expect(m.generatedSections).not.toContain("drop me");
  });

  it("pre-formats times and the date label so the runner needs no timezone", async () => {
    await addMeeting(wsA, { notes: "n" });
    const res = await contextFor(wsA);
    expect(item(res).dateLabel).toBe("Monday, September 14, 2026");
    // 13:00Z on 2026-09-14 is 9:00 AM in America/New_York (EDT).
    expect((item(res).meetings as ContextMeeting[])[0].timeLabel).toBe(
      "9:00 AM – 10:00 AM",
    );
  });

  it("reports the computed header figures", async () => {
    await addMeeting(wsA, { notes: "a" });
    await addMeeting(wsA, {
      notes: "b",
      startTime: new Date("2026-09-14T15:00:00Z"),
      endTime: new Date("2026-09-14T17:45:00Z"),
    });
    const res = await contextFor(wsA);
    expect(item(res).meetingCount).toBe(2);
    expect(item(res).totalTimeLabel).toBe("3h 45m");
  });

  it("includes attendees when the calendar captured them", async () => {
    await addMeeting(wsA, {
      notes: "n",
      attendees: [{ name: "Alex Rivera" }, { email: "sam@example.com" }],
    });
    const res = await contextFor(wsA);
    expect((item(res).meetings as ContextMeeting[])[0].attendees).toEqual([
      "Alex Rivera",
      "sam@example.com",
    ]);
  });

  it("omits meetings with no notes, and those hidden from the day view", async () => {
    await addMeeting(wsA, { notes: "kept" });
    await addMeeting(wsA, { title: "No notes", notes: "" });
    await addMeeting(wsA, {
      title: "Skipped one",
      notes: "should not be summarized",
      skipped: true,
    });
    const res = await contextFor(wsA);
    const titles = (item(res).meetings as ContextMeeting[]).map((m) => m.title);
    expect(titles).toEqual(["Standup"]);
    expect(item(res).meetingCount).toBe(1);
  });

  it("is a 200 with hasNotes:false on a day with nothing to summarize", async () => {
    // The nightly runner hits this every quiet weekend; a 4xx would turn each
    // one into a failed job.
    await addMeeting(wsA, { notes: "" });
    const res = await contextFor(wsA);
    expect(res.status).toBe(200);
    expect(item(res).hasNotes).toBe(false);
    expect(item(res).meetings).toEqual([]);
  });

  it("carries a fingerprint the runner can echo back", async () => {
    await addMeeting(wsA, { notes: "n" });
    const res = await contextFor(wsA);
    expect(item(res).inputFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is scoped to the requested workspace", async () => {
    await addMeeting(wsB, { notes: "beta only" });
    expect(item(await contextFor(wsA)).hasNotes).toBe(false);
  });

  it("rejects a malformed date and 403s when meetings are off", async () => {
    expect((await contextFor(wsA, "09/14/2026")).status).toBe(400);
    const off = await makeWorkspace("NoMeetings", {
      disabledFeatures: ["meetings"],
    });
    expect((await contextFor(off)).status).toBe(403);
  });
});

describe("PUT /api/v1/day-summaries", () => {
  const push = (workspaceId: string, body: Record<string, unknown>) =>
    call(putDaySummary, {
      method: "PUT",
      bearer: write,
      query: { workspace: workspaceId },
      body,
    });

  it("creates with 201, then upserts the same day with 200 keeping the id", async () => {
    const created = await push(wsA, {
      date: DAY,
      markdown: "# v1",
      model: "claude-opus-5",
    });
    expect(created.status).toBe(201);
    expect(item(created).day).toBe(DAY);
    expect(item(created).model).toBe("claude-opus-5");

    const updated = await push(wsA, { date: DAY, markdown: "# v2" });
    expect(updated.status).toBe(200);
    expect(item(updated).id).toBe(item(created).id);
    expect(item(updated).markdown).toBe("# v2");

    const list = await call(listDaySummaries, {
      bearer: read,
      query: { workspace: wsA },
    });
    expect((list.json.items as unknown[]).length).toBe(1);
  });

  it("accepts any past day", async () => {
    expect((await push(wsA, { date: "2020-02-03", markdown: "# old" })).status).toBe(
      201,
    );
  });

  it("stores the pushed fingerprint as given, not one recomputed on arrival", async () => {
    // The runner reads context, spends minutes in the model, then pushes. If a
    // note lands in between, recomputing here would make a summary written from
    // the OLD inputs look current — the one case staleness exists to catch.
    const m = await addMeeting(wsA, { notes: "first pass" });
    const ctx = await contextFor(wsA);
    const fingerprint = item(ctx).inputFingerprint as string;

    await saveMeetingNotes(m.id, "the candid version, typed at 19:31", null);
    await push(wsA, { date: DAY, markdown: "# written earlier", inputFingerprint: fingerprint });

    const view = await getDaySummaryView(wsA, DAY);
    expect(view.stale).toBe(true);
  });

  it("falls back to computing a fingerprint when none is supplied", async () => {
    await addMeeting(wsA, { notes: "n" });
    await push(wsA, { date: DAY, markdown: "# hand-rolled" });
    const view = await getDaySummaryView(wsA, DAY);
    expect(view.stale).toBe(false);
  });

  it("rejects a missing date, a malformed date, or an empty body", async () => {
    for (const body of [
      { markdown: "# x" },
      { date: "09/14/2026", markdown: "# x" },
      { date: DAY },
      { date: DAY, markdown: "   " },
    ]) {
      const res = await push(wsA, body);
      expect(res.status).toBe(400);
      expect(res.json.error).toBeTruthy();
    }
  });

  it("rejects a read-only token and a workspace with meetings off", async () => {
    const ro = await call(putDaySummary, {
      method: "PUT",
      bearer: read,
      query: { workspace: wsA },
      body: { date: DAY, markdown: "# x" },
    });
    expect(ro.status).toBe(403);

    const off = await makeWorkspace("NoMeetings", {
      disabledFeatures: ["meetings"],
    });
    expect((await push(off, { date: DAY, markdown: "# x" })).status).toBe(403);
  });
});

describe("GET /api/v1/day-summaries", () => {
  it("lists meta without bodies, newest day first, and honours from/to", async () => {
    for (const d of [DAY, "2026-09-10"]) {
      await call(putDaySummary, {
        method: "PUT",
        bearer: write,
        query: { workspace: wsA },
        body: { date: d, markdown: `# ${d}` },
      });
    }
    const all = await call(listDaySummaries, {
      bearer: read,
      query: { workspace: wsA },
    });
    const items = all.json.items as Record<string, unknown>[];
    expect(items.map((i) => i.day)).toEqual([DAY, "2026-09-10"]);
    expect(items[0].markdown).toBeUndefined();

    const narrowed = await call(listDaySummaries, {
      bearer: read,
      query: { workspace: wsA, from: "2026-09-12", to: "2026-09-20" },
    });
    expect((narrowed.json.items as unknown[]).length).toBe(1);
  });

  it("rejects a malformed range", async () => {
    const res = await call(listDaySummaries, {
      bearer: read,
      query: { workspace: wsA, from: "nope" },
    });
    expect(res.status).toBe(400);
  });
});

describe("GET/PATCH /api/v1/day-summaries/[id]", () => {
  async function seed() {
    const res = await call(putDaySummary, {
      method: "PUT",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY, markdown: "# generated" },
    });
    return item(res).id as string;
  }

  it("returns the full body by id", async () => {
    const id = await seed();
    const res = await call(getDaySummary, { bearer: read, params: { id } });
    expect(res.status).toBe(200);
    expect(item(res).markdown).toBe("# generated");
  });

  it("404s for a row in a workspace the token can't see", async () => {
    const id = await seed();
    const scoped = await makeToken({ scope: "read", workspaceIds: [wsB] });
    const res = await call(getDaySummary, { bearer: scoped, params: { id } });
    expect(res.status).toBe(404);
  });

  it("stores an edit separately and leaves the generated body intact", async () => {
    const id = await seed();
    const res = await call(patchDaySummary, {
      method: "PATCH",
      bearer: write,
      params: { id },
      body: { markdown: "# my own words" },
    });
    expect(res.status).toBe(200);
    expect(item(res).markdownEdited).toBe("# my own words");
    expect(item(res).markdown).toBe("# generated");
  });

  it("a re-push replaces the generated body but never the edit", async () => {
    const id = await seed();
    await call(patchDaySummary, {
      method: "PATCH",
      bearer: write,
      params: { id },
      body: { markdown: "# my own words" },
    });
    await call(putDaySummary, {
      method: "PUT",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY, markdown: "# regenerated" },
    });
    const after = await call(getDaySummary, { bearer: read, params: { id } });
    expect(item(after).markdown).toBe("# regenerated");
    expect(item(after).markdownEdited).toBe("# my own words");
  });

  it("markdown: null resets back to the generated body", async () => {
    const id = await seed();
    await call(patchDaySummary, {
      method: "PATCH",
      bearer: write,
      params: { id },
      body: { markdown: "# mine" },
    });
    const res = await call(patchDaySummary, {
      method: "PATCH",
      bearer: write,
      params: { id },
      body: { markdown: null },
    });
    expect(item(res).markdownEdited).toBeNull();
  });

  it("rejects a body with nothing to update", async () => {
    const id = await seed();
    const res = await call(patchDaySummary, {
      method: "PATCH",
      bearer: write,
      params: { id },
      body: {},
    });
    expect(res.status).toBe(400);
  });
});

describe("day-view state", () => {
  it("flags stale once notes change after the summary was written", async () => {
    const m = await addMeeting(wsA, { notes: "first pass" });
    const ctx = await contextFor(wsA);
    await call(putDaySummary, {
      method: "PUT",
      bearer: write,
      query: { workspace: wsA },
      body: {
        date: DAY,
        markdown: "# summary",
        inputFingerprint: item(ctx).inputFingerprint,
      },
    });
    expect((await getDaySummaryView(wsA, DAY)).stale).toBe(false);

    await saveMeetingNotes(m.id, "the candid version, typed at 19:31", null);

    const after = await getDaySummaryView(wsA, DAY);
    expect(after.stale).toBe(true);
    // Flagged, never silently rewritten.
    expect(after.summary?.markdown).toBe("# summary");
  });

  it("is not marked stale by a note-less meeting appearing (an ICS import)", async () => {
    await addMeeting(wsA, { notes: "kept" });
    const ctx = await contextFor(wsA);
    await call(putDaySummary, {
      method: "PUT",
      bearer: write,
      query: { workspace: wsA },
      body: {
        date: DAY,
        markdown: "# summary",
        inputFingerprint: item(ctx).inputFingerprint,
      },
    });
    await addMeeting(wsA, {
      title: "Newly imported",
      notes: "",
      startTime: new Date("2026-09-14T18:00:00Z"),
    });
    expect((await getDaySummaryView(wsA, DAY)).stale).toBe(false);
  });
});
