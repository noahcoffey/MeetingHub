import { beforeEach, describe, expect, it, vi } from "vitest";

// The one LLM dependency in the app lives in lib/day-summary-model; stubbing it
// keeps these tests offline and key-free while still exercising the real route,
// lib, prompt-building and persistence paths.
const generate = vi.fn(async (prompt: string) => ({
  markdown: `# summary\n\nprompt bytes: ${prompt.length}`,
  model: "test-model",
}));
vi.mock("@/lib/day-summary-model", () => ({
  DAY_SUMMARY_MODEL: "test-model",
  isDaySummaryConfigured: () => true,
  generateWithClaude: (p: string) => generate(p),
  DaySummaryNotConfiguredError: class extends Error {},
}));

const { GET: listDaySummaries, POST: postDaySummary } = await import(
  "@/app/api/v1/day-summaries/route"
);
const { GET: getDaySummary, PATCH: patchDaySummary } = await import(
  "@/app/api/v1/day-summaries/[id]/route"
);
const { db } = await import("@/db");
const { meetings } = await import("@/db/schema");
const { call, makeToken, makeWorkspace, resetDb } = await import("../helpers");

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
  } = {},
) {
  const [row] = await db
    .insert(meetings)
    .values({
      workspaceId,
      title: over.title ?? "Standup",
      startTime: over.startTime ?? new Date("2026-09-14T13:00:00Z"),
      endTime: over.endTime === undefined ? new Date("2026-09-14T14:00:00Z") : over.endTime,
      notes: over.notes ?? "",
      notesGenerated: over.notesGenerated ?? null,
      notesGeneratedUpdatedAt: over.notesGenerated ? new Date() : null,
    })
    .returning();
  return row;
}

beforeEach(async () => {
  await resetDb();
  generate.mockClear();
  wsA = await makeWorkspace("Alpha", { isDefault: true });
  wsB = await makeWorkspace("Beta");
  write = await makeToken({ scope: "write" });
  read = await makeToken({ scope: "read" });
});

const item = (r: { json: Record<string, unknown> }) =>
  r.json.item as Record<string, unknown>;

describe("POST /api/v1/day-summaries", () => {
  it("generates from the day's noted meetings and stores the model + fingerprint", async () => {
    await addMeeting(wsA, { notes: "Atlas is the platform of record." });
    const res = await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY },
    });
    expect(res.status).toBe(201);
    expect(item(res).status).toBe("ready");
    expect(item(res).model).toBe("test-model");
    expect(item(res).day).toBe(DAY);
    expect(item(res).inputFingerprint).not.toBe("");
    expect(generate).toHaveBeenCalledOnce();
    // Manual notes reach the model in full.
    expect(generate.mock.calls[0][0]).toContain("Atlas is the platform of record.");
  });

  it("works for a past day — looking back is the point", async () => {
    await addMeeting(wsA, {
      notes: "old meeting",
      startTime: new Date("2020-02-03T14:00:00Z"),
      endTime: new Date("2020-02-03T15:00:00Z"),
    });
    const res = await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: "2020-02-03" },
    });
    expect(res.status).toBe(201);
  });

  it("is idempotent per day: regenerating replaces the same row", async () => {
    await addMeeting(wsA, { notes: "n" });
    const first = await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY },
    });
    const second = await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY },
    });
    // 201 created, then 200 overwritten — the repo's upsert convention.
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(item(second).id).toBe(item(first).id);

    const list = await call(listDaySummaries, {
      bearer: read,
      query: { workspace: wsA },
    });
    expect((list.json.items as unknown[]).length).toBe(1);
  });

  it("refuses, without calling the model, when no meeting that day has notes", async () => {
    await addMeeting(wsA, { notes: "", notesGenerated: null });
    const res = await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY },
    });
    expect(res.status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });

  it("only sees the requested workspace's meetings", async () => {
    await addMeeting(wsB, { notes: "beta only" });
    const res = await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY },
    });
    expect(res.status).toBe(400);
  });

  it("skips meetings hidden from the day view", async () => {
    const m = await addMeeting(wsA, { notes: "kept" });
    await db
      .insert(meetings)
      .values({
        workspaceId: wsA,
        title: "Skipped one",
        startTime: new Date("2026-09-14T15:00:00Z"),
        notes: "should not be summarized",
        skipped: true,
      });
    await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY },
    });
    const prompt = generate.mock.calls[0][0];
    expect(prompt).toContain("kept");
    expect(prompt).not.toContain("should not be summarized");
    expect(m.id).toBeTruthy();
  });

  it("passes only Summary/Decisions/Action Items from generated notes", async () => {
    await addMeeting(wsA, {
      notes: "manual",
      notesGenerated:
        "## Summary\nkeep me\n\n## Key Discussion Points\ndrop me\n\n## Action Items\nkeep me too",
    });
    await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY },
    });
    const prompt = generate.mock.calls[0][0];
    expect(prompt).toContain("keep me");
    expect(prompt).toContain("keep me too");
    expect(prompt).not.toContain("drop me");
  });

  it("rejects a missing or malformed date", async () => {
    for (const body of [{}, { date: "09/14/2026" }, { date: 20260914 }]) {
      const res = await call(postDaySummary, {
        method: "POST",
        bearer: write,
        query: { workspace: wsA },
        body,
      });
      expect(res.status).toBe(400);
      expect(res.json.error).toBeTruthy();
    }
  });

  it("rejects a read-only token", async () => {
    const res = await call(postDaySummary, {
      method: "POST",
      bearer: read,
      query: { workspace: wsA },
      body: { date: DAY },
    });
    expect(res.status).toBe(403);
  });

  it("403s when the meetings feature is off", async () => {
    const off = await makeWorkspace("NoMeetings", {
      disabledFeatures: ["meetings"],
    });
    const res = await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: off },
      body: { date: DAY },
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/day-summaries", () => {
  it("lists meta without bodies, newest day first, and honours from/to", async () => {
    await addMeeting(wsA, { notes: "a" });
    await addMeeting(wsA, {
      notes: "b",
      startTime: new Date("2026-09-10T13:00:00Z"),
      endTime: new Date("2026-09-10T14:00:00Z"),
    });
    for (const d of [DAY, "2026-09-10"]) {
      await call(postDaySummary, {
        method: "POST",
        bearer: write,
        query: { workspace: wsA },
        body: { date: d },
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
    await addMeeting(wsA, { notes: "n" });
    const res = await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY },
    });
    return item(res).id as string;
  }

  it("returns the full body by id", async () => {
    const id = await seed();
    const res = await call(getDaySummary, { bearer: read, params: { id } });
    expect(res.status).toBe(200);
    expect(item(res).markdown).toContain("# summary");
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
    expect(item(res).markdown).toContain("# summary");
  });

  it("regeneration replaces the generated body but never the edit", async () => {
    const id = await seed();
    await call(patchDaySummary, {
      method: "PATCH",
      bearer: write,
      params: { id },
      body: { markdown: "# my own words" },
    });
    generate.mockResolvedValueOnce({ markdown: "# regenerated", model: "test-model" });
    await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY },
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

describe("staleness", () => {
  it("flags the summary once notes change after generation", async () => {
    const { getDaySummaryView } = await import("@/lib/day-summaries");
    const m = await addMeeting(wsA, { notes: "first pass" });
    await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY },
    });

    const fresh = await getDaySummaryView(wsA, DAY);
    expect(fresh.status).toBe("ready");
    expect(fresh.stale).toBe(false);

    const { saveMeetingNotes } = await import("@/lib/meetings");
    await saveMeetingNotes(m.id, "the candid version, typed at 19:31", null);

    const after = await getDaySummaryView(wsA, DAY);
    expect(after.stale).toBe(true);
    // §6 — flagged, never silently regenerated.
    expect(after.summary?.markdown).toContain("# summary");
  });

  it("is not marked stale by a note-less meeting appearing (an ICS import)", async () => {
    const { getDaySummaryView } = await import("@/lib/day-summaries");
    await addMeeting(wsA, { notes: "kept" });
    await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY },
    });
    await addMeeting(wsA, {
      title: "Newly imported",
      notes: "",
      startTime: new Date("2026-09-14T18:00:00Z"),
    });
    expect((await getDaySummaryView(wsA, DAY)).stale).toBe(false);
  });
});

describe("failures", () => {
  it("records a failed status instead of leaving the row generating", async () => {
    const { getDaySummaryView } = await import("@/lib/day-summaries");
    await addMeeting(wsA, { notes: "n" });
    generate.mockRejectedValueOnce(new Error("upstream exploded"));
    const res = await call(postDaySummary, {
      method: "POST",
      bearer: write,
      query: { workspace: wsA },
      body: { date: DAY },
    });
    expect(res.status).toBe(502);
    const view = await getDaySummaryView(wsA, DAY);
    expect(view.status).toBe("failed");
    expect(view.summary?.error).toBe("upstream exploded");
  });
});
