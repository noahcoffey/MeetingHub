import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings, pendingIngests } from "@/db/schema";
import { ingestGeneratedNotes, listPendingIngests } from "@/lib/ingest";
import { upsertCalendarMeetings } from "@/lib/meetings";
import { makeWorkspace, resetDb } from "../helpers";

let ws: string;

beforeEach(async () => {
  await resetDb();
  ws = await makeWorkspace("Alpha", { isDefault: true });
});

async function calMeeting(workspaceId: string, uid: string, title = "Sync") {
  await upsertCalendarMeetings(workspaceId, [
    {
      calendarEventId: uid,
      title,
      description: null,
      startTime: new Date("2026-07-10T15:00:00Z"),
      endTime: null,
      attendees: [],
    },
  ]);
  const [m] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.calendarEventId, uid));
  return m;
}

describe("ingestGeneratedNotes", () => {
  it("writes generated notes to a matched meeting", async () => {
    const m = await calMeeting(ws, "uid-1");
    const res = await ingestGeneratedNotes({
      sourceId: "uid-1",
      notesGenerated: "## AI notes",
    });
    expect(res).toEqual({ matched: true, meetingId: m.id, written: true });
    const [after] = await db.select().from(meetings).where(eq(meetings.id, m.id));
    expect(after.notesGenerated).toBe("## AI notes");
  });

  it("never clobbers existing generated notes (safe re-push)", async () => {
    const m = await calMeeting(ws, "uid-2");
    await ingestGeneratedNotes({ sourceId: "uid-2", notesGenerated: "first" });
    const res = await ingestGeneratedNotes({
      sourceId: "uid-2",
      notesGenerated: "second",
    });
    expect(res).toEqual({ matched: true, meetingId: m.id, written: false });
    const [after] = await db.select().from(meetings).where(eq(meetings.id, m.id));
    expect(after.notesGenerated).toBe("first");
  });

  it("also matches on external_ref", async () => {
    const m = await calMeeting(ws, "cal-1");
    await db
      .update(meetings)
      .set({ externalRef: "ext-1" })
      .where(eq(meetings.id, m.id));
    const res = await ingestGeneratedNotes({
      sourceId: "ext-1",
      notesGenerated: "via external ref",
    });
    expect(res).toMatchObject({ matched: true, meetingId: m.id, written: true });
  });

  it("stages an unmatched push in the pending inbox", async () => {
    const res = await ingestGeneratedNotes({
      sourceId: "unknown-uid",
      title: "Ad-hoc",
      notesGenerated: "notes",
    });
    expect(res.matched).toBe(false);
    const pending = await listPendingIngests();
    expect(pending).toHaveLength(1);
    expect(pending[0].sourceId).toBe("unknown-uid");
  });

  it("dedupes repeated unmatched pushes by sourceId", async () => {
    const a = await ingestGeneratedNotes({ sourceId: "dup", notesGenerated: "v1" });
    const b = await ingestGeneratedNotes({ sourceId: "dup", notesGenerated: "v2" });
    expect(a.matched).toBe(false);
    expect(b.matched).toBe(false);
    if (!a.matched && !b.matched) expect(a.pendingId).toBe(b.pendingId);
    expect(await listPendingIngests()).toHaveLength(1);
  });

  it("pre-tags a pending push with a case-insensitive workspace hint", async () => {
    const kiwanis = await makeWorkspace("Kiwanis");
    const res = await ingestGeneratedNotes({
      sourceId: "x",
      notesGenerated: "n",
      workspaceHint: "kiwanis",
    });
    if (res.matched) throw new Error("expected pending");
    const [p] = await db
      .select()
      .from(pendingIngests)
      .where(eq(pendingIngests.id, res.pendingId));
    expect(p.workspaceId).toBe(kiwanis);
    expect(p.workspaceHint).toBe("kiwanis");
  });
});
