import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { ingestGeneratedNotes } from "@/lib/ingest";
import {
  listSkippedWithGeneratedForDate,
  moveGeneratedNotes,
  skipMeeting,
  upsertCalendarMeetings,
} from "@/lib/meetings";
import { makeWorkspace, resetDb } from "../helpers";

let ws: string;

beforeEach(async () => {
  await resetDb();
  ws = await makeWorkspace("Alpha", { isDefault: true });
});

// 15:00Z on 2026-07-10 is the morning of the 10th in the app tz (America/*),
// so both meetings land on the same calendar day the day view asks for.
const DAY = "2026-07-10";

async function calMeeting(workspaceId: string, uid: string, title: string) {
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

async function read(id: string) {
  const [m] = await db.select().from(meetings).where(eq(meetings.id, id));
  return m;
}

describe("stranded Notes+ on a skipped meeting", () => {
  it("surfaces a skipped meeting that received generated notes", async () => {
    const skipped = await calMeeting(ws, "uid-skip", "Standup");
    await skipMeeting(skipped.id);
    await ingestGeneratedNotes({
      sourceId: "uid-skip",
      notesGenerated: "## AI notes",
    });

    const rows = await listSkippedWithGeneratedForDate(ws, DAY);
    expect(rows.map((r) => r.id)).toEqual([skipped.id]);
  });

  it("ignores skipped meetings without generated notes, and unskipped ones with", async () => {
    const bare = await calMeeting(ws, "uid-bare", "Bare");
    await skipMeeting(bare.id);
    const live = await calMeeting(ws, "uid-live", "Live");
    await ingestGeneratedNotes({ sourceId: "uid-live", notesGenerated: "x" });

    expect(await listSkippedWithGeneratedForDate(ws, DAY)).toEqual([]);
    expect(bare.id && live.id).toBeTruthy();
  });

  it("moves the notes to another meeting and clears the source", async () => {
    const from = await calMeeting(ws, "uid-from", "Wrong");
    const to = await calMeeting(ws, "uid-to", "Right");
    await skipMeeting(from.id);
    await ingestGeneratedNotes({
      sourceId: "uid-from",
      notesGenerated: "## AI notes",
    });

    expect(await moveGeneratedNotes(from.id, to.id)).toEqual({ ok: true });

    const src = await read(from.id);
    const dst = await read(to.id);
    expect(src.notesGenerated).toBeNull();
    expect(src.notesGeneratedUpdatedAt).toBeNull();
    expect(dst.notesGenerated).toBe("## AI notes");
    // The source keeps skipped=true; Restore is a separate action.
    expect(src.skipped).toBe(true);
    // Banner clears once the notes are gone.
    expect(await listSkippedWithGeneratedForDate(ws, DAY)).toEqual([]);
  });

  it("sends a later push for the same sourceId to the target, not the source", async () => {
    const from = await calMeeting(ws, "uid-dup", "Wrong");
    const to = await calMeeting(ws, "uid-dest", "Right");
    await skipMeeting(from.id);
    await ingestGeneratedNotes({ sourceId: "uid-dup", notesGenerated: "first" });
    await moveGeneratedNotes(from.id, to.id);

    // Same sourceId re-pushed (agent re-run). It must land on the meeting that
    // now holds the notes, and be refused as already-written there.
    const res = await ingestGeneratedNotes({
      sourceId: "uid-dup",
      notesGenerated: "second",
    });
    expect(res).toEqual({ matched: true, meetingId: to.id, written: false });
    expect((await read(from.id)).notesGenerated).toBeNull();
  });

  it("refuses a target that already has generated notes", async () => {
    const from = await calMeeting(ws, "uid-a", "A");
    const to = await calMeeting(ws, "uid-b", "B");
    await ingestGeneratedNotes({ sourceId: "uid-a", notesGenerated: "a" });
    await ingestGeneratedNotes({ sourceId: "uid-b", notesGenerated: "b" });

    expect(await moveGeneratedNotes(from.id, to.id)).toEqual({
      ok: false,
      reason: "target-occupied",
    });
    expect((await read(from.id)).notesGenerated).toBe("a");
  });

  it("refuses a cross-workspace target, an empty source, and itself", async () => {
    const other = await makeWorkspace("Beta");
    const from = await calMeeting(ws, "uid-x", "X");
    const far = await calMeeting(other, "uid-y", "Y");
    const empty = await calMeeting(ws, "uid-z", "Z");
    await ingestGeneratedNotes({ sourceId: "uid-x", notesGenerated: "x" });

    expect(await moveGeneratedNotes(from.id, far.id)).toEqual({
      ok: false,
      reason: "cross-workspace",
    });
    expect(await moveGeneratedNotes(empty.id, from.id)).toEqual({
      ok: false,
      reason: "empty-source",
    });
    expect(await moveGeneratedNotes(from.id, from.id)).toEqual({
      ok: false,
      reason: "same-meeting",
    });
  });
});
