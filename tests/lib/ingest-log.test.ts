import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { ingestEvents, meetings, pendingIngests } from "@/db/schema";
import {
  ingestGeneratedNotes,
  listIngestEvents,
  listPendingIngests,
  matchPendingToMeeting,
  reassociateIngestEvent,
  reassociateIngestEventToNew,
} from "@/lib/ingest";
import { moveGeneratedNotes, upsertCalendarMeetings } from "@/lib/meetings";
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

async function meeting(id: string) {
  const [m] = await db.select().from(meetings).where(eq(meetings.id, id));
  return m;
}

describe("ingest log", () => {
  it("logs a written match with the meeting it landed on", async () => {
    const m = await calMeeting(ws, "uid-1");
    await ingestGeneratedNotes({ sourceId: "uid-1", notesGenerated: "## A" });
    const [row] = await listIngestEvents();
    expect(row.outcome).toBe("matched_written");
    expect(row.meetingId).toBe(m.id);
    expect(row.matchedMeetingId).toBe(m.id);
    expect(row.meeting?.holdsBody).toBe(true);
    expect(row.meeting?.skipped).toBe(false);
  });

  it("logs a dropped push (target already had notes) WITH its body", async () => {
    const m = await calMeeting(ws, "uid-2");
    await ingestGeneratedNotes({ sourceId: "uid-2", notesGenerated: "first" });
    await ingestGeneratedNotes({ sourceId: "uid-2", notesGenerated: "second" });
    const rows = await listIngestEvents();
    expect(rows).toHaveLength(2);
    expect(rows[0].outcome).toBe("matched_not_written");
    expect(rows[0].notesGenerated).toBe("second");
    expect(rows[0].meetingId).toBe(m.id);
    expect(rows[0].meeting?.holdsBody).toBe(false);
    expect(rows[0].meeting?.hasGenerated).toBe(true);
  });

  it("flags a skipped or hidden-title meeting on the row", async () => {
    const m = await calMeeting(ws, "uid-3", "Standup");
    await db.update(meetings).set({ skipped: true }).where(eq(meetings.id, m.id));
    await db.execute(
      `insert into hidden_meeting_titles (workspace_id, title) values ('${ws}', 'Standup')`,
    );
    await ingestGeneratedNotes({ sourceId: "uid-3", notesGenerated: "x" });
    const [row] = await listIngestEvents();
    expect(row.meeting?.skipped).toBe(true);
    expect(row.meeting?.hidden).toBe(true);
  });

  it("logs an unmatched push as pending and settles it on review", async () => {
    await ingestGeneratedNotes({
      sourceId: "ext-1",
      title: "Ad hoc",
      notesGenerated: "body",
    });
    let [row] = await listIngestEvents();
    expect(row.outcome).toBe("pending");
    expect(row.meetingId).toBeNull();
    expect(row.stillPending).toBe(true);

    const target = await calMeeting(ws, "uid-4");
    const [pending] = await listPendingIngests();
    await matchPendingToMeeting(pending.id, target.id);
    [row] = await listIngestEvents();
    expect(row.meetingId).toBe(target.id);
    expect(row.stillPending).toBe(false);
  });

  it("re-associates: writes the body from the log, clears the old meeting, releases refs", async () => {
    const wrong = await calMeeting(ws, "uid-5", "Wrong");
    const right = await calMeeting(ws, "uid-6", "Right");
    await ingestGeneratedNotes({ sourceId: "uid-5", notesGenerated: "notes" });
    const [row] = await listIngestEvents();

    const res = await reassociateIngestEvent(row.id, right.id);
    expect(res).toEqual({ ok: true, meetingId: right.id });

    const after = await meeting(right.id);
    expect(after.notesGenerated).toBe("notes");
    expect(after.externalRef).toBe("uid-5");
    const old = await meeting(wrong.id);
    expect(old.notesGenerated).toBeNull();

    const [logged] = await listIngestEvents();
    expect(logged.meetingId).toBe(right.id);
    expect(logged.matchedMeetingId).toBe(wrong.id);
    expect(logged.reassignedAt).not.toBeNull();
    expect(logged.matchedMeeting?.id).toBe(wrong.id);
  });

  it("re-associates a DROPPED push without touching the old meeting's other notes", async () => {
    const wrong = await calMeeting(ws, "uid-7", "Wrong");
    const right = await calMeeting(ws, "uid-8", "Right");
    await ingestGeneratedNotes({ sourceId: "uid-7", notesGenerated: "first" });
    await ingestGeneratedNotes({ sourceId: "uid-7", notesGenerated: "second" });
    const [dropped] = await listIngestEvents();
    expect(dropped.outcome).toBe("matched_not_written");

    const res = await reassociateIngestEvent(dropped.id, right.id);
    expect(res.ok).toBe(true);
    expect((await meeting(right.id)).notesGenerated).toBe("second");
    // "first" was a different push; it stays where it is.
    expect((await meeting(wrong.id)).notesGenerated).toBe("first");
  });

  it("refuses an occupied target and the same meeting", async () => {
    const a = await calMeeting(ws, "uid-9", "A");
    const b = await calMeeting(ws, "uid-10", "B");
    await ingestGeneratedNotes({ sourceId: "uid-9", notesGenerated: "a" });
    await ingestGeneratedNotes({ sourceId: "uid-10", notesGenerated: "b" });
    const rows = await listIngestEvents();
    const rowA = rows.find((r) => r.sourceId === "uid-9")!;
    expect(await reassociateIngestEvent(rowA.id, b.id)).toEqual({
      ok: false,
      reason: "target-occupied",
    });
    expect(await reassociateIngestEvent(rowA.id, a.id)).toEqual({
      ok: false,
      reason: "same-meeting",
    });
  });

  it("re-associates into a brand-new meeting and clears any inbox item", async () => {
    await ingestGeneratedNotes({
      sourceId: "ext-2",
      title: "Client call",
      startTime: new Date("2026-07-11T10:00:00Z"),
      notesGenerated: "body",
    });
    const [row] = await listIngestEvents();
    const res = await reassociateIngestEventToNew(row.id, ws);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const m = await meeting(res.meetingId);
    expect(m.title).toBe("Client call");
    expect(m.notesGenerated).toBe("body");
    expect(m.externalRef).toBe("ext-2");
    expect(m.workspaceId).toBe(ws);
    expect(await db.select().from(pendingIngests)).toHaveLength(0);
  });

  it("creates the new meeting in the workspace the user picked, over the push's hint", async () => {
    const other = await makeWorkspace("Beta");
    await ingestGeneratedNotes({
      sourceId: "ext-3",
      title: "Hinted",
      workspaceHint: "Alpha",
      notesGenerated: "body",
    });
    const [row] = await listIngestEvents();
    expect(row.workspaceId).toBe(ws);
    const res = await reassociateIngestEventToNew(row.id, ws, other);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect((await meeting(res.meetingId)).workspaceId).toBe(other);
  });

  it("re-association also settles sibling pending log rows for the sourceId", async () => {
    await ingestGeneratedNotes({ sourceId: "ext-4", notesGenerated: "v1" });
    await ingestGeneratedNotes({ sourceId: "ext-4", notesGenerated: "v2" });
    const target = await calMeeting(ws, "uid-16");
    const [latest] = await listIngestEvents();
    expect((await reassociateIngestEvent(latest.id, target.id)).ok).toBe(true);
    const rows = await listIngestEvents();
    expect(rows.map((r) => r.meetingId)).toEqual([target.id, target.id]);
    expect(rows.every((r) => !r.stillPending)).toBe(true);
  });

  it("stays re-associated after an ICS re-import bumps the old meeting", async () => {
    const wrong = await calMeeting(ws, "uid-11", "Wrong");
    const right = await calMeeting(ws, "uid-12", "Right");
    await ingestGeneratedNotes({ sourceId: "uid-11", notesGenerated: "v1" });
    const [row] = await listIngestEvents();
    await reassociateIngestEvent(row.id, right.id);

    // Re-import touches the old row's updated_at (the tie-break of last resort).
    await calMeeting(ws, "uid-11", "Wrong (renamed)");
    // Clear the target so a re-push has somewhere to write.
    await db
      .update(meetings)
      .set({ notesGenerated: null })
      .where(eq(meetings.id, right.id));

    const res = await ingestGeneratedNotes({
      sourceId: "uid-11",
      notesGenerated: "v2",
    });
    expect(res).toEqual({ matched: true, meetingId: right.id, written: true });
    expect((await meeting(wrong.id)).notesGenerated).toBeNull();
  });

  it("follows notes moved through moveGeneratedNotes", async () => {
    const a = await calMeeting(ws, "uid-13", "A");
    const b = await calMeeting(ws, "uid-14", "B");
    await ingestGeneratedNotes({ sourceId: "uid-13", notesGenerated: "n" });
    expect((await moveGeneratedNotes(a.id, b.id)).ok).toBe(true);
    const [row] = await listIngestEvents();
    expect(row.meetingId).toBe(b.id);
    expect(row.reassignedAt).not.toBeNull();
  });

  it("survives the associated meeting being deleted", async () => {
    const m = await calMeeting(ws, "uid-15");
    await ingestGeneratedNotes({ sourceId: "uid-15", notesGenerated: "n" });
    await db.delete(meetings).where(eq(meetings.id, m.id));
    const [row] = await listIngestEvents();
    expect(row.meetingId).toBeNull();
    expect(row.meeting).toBeNull();
    expect(await db.select().from(ingestEvents)).toHaveLength(1);
  });
});
