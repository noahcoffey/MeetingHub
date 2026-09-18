import "server-only";
import { and, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
// Ingest matching is GLOBAL across workspaces — calendar UIDs are unique per
// feed in practice, so an exact sourceId match is trusted wherever it lives.
// The optional `workspace` hint (the source app sends its own workspace name)
// breaks ties toward that workspace and routes UNMATCHED pushes: the pending
// row is pre-tagged so review lands it in the right place.
import { db } from "@/db";
import {
  hiddenMeetingTitles,
  ingestEvents,
  meetings,
  pendingIngests,
  workspaces,
  type IngestEvent,
  type PendingIngest,
} from "@/db/schema";

export type IngestInput = {
  sourceId: string;
  title?: string;
  startTime?: Date | null;
  notesGenerated: string;
  // The source app's workspace name; resolved case-insensitively against
  // workspaces.name. Unresolvable hints are kept for display but don't block.
  workspaceHint?: string;
};

async function resolveWorkspaceHint(
  hint: string | undefined,
): Promise<string | null> {
  const name = hint?.trim();
  if (!name) return null;
  const [w] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(sql`lower(${workspaces.name}) = ${name.toLowerCase()}`)
    .limit(1);
  return w?.id ?? null;
}

export type IngestResult =
  | { matched: true; meetingId: string; written: boolean }
  | { matched: false; pending: true; pendingId: string };

// Apply a generated-notes push. Matches the meeting by calendar_event_id OR
// external_ref; writes notes_generated only if empty (last-write-never-clobbers).
// No match → stage in the pending-ingests inbox (deduped by sourceId).
export async function ingestGeneratedNotes(
  input: IngestInput,
): Promise<IngestResult> {
  const { sourceId, notesGenerated } = input;
  const hintedWorkspaceId = await resolveWorkspaceHint(input.workspaceHint);

  const [meeting] = await db
    .select()
    .from(meetings)
    .where(
      or(
        eq(meetings.calendarEventId, sourceId),
        eq(meetings.externalRef, sourceId),
      ),
    )
    // calendar_event_id is unique per workspace, not globally — if the same
    // feed lands in two workspaces, prefer the hinted workspace's copy, then
    // the most recently touched one so the match is deterministic.
    // An explicit external_ref (set by review / re-associate — a human
    // decision) always beats an incidental calendar-UID match; otherwise an
    // ICS re-import bumping the old row's updated_at would undo the fix.
    .orderBy(
      sql`(${meetings.externalRef} IS NOT DISTINCT FROM ${sourceId}) DESC`,
      ...(hintedWorkspaceId
        ? [sql`(${meetings.workspaceId} = ${hintedWorkspaceId}) DESC`]
        : []),
      desc(meetings.updatedAt),
    )
    .limit(1);

  const logBase = {
    sourceId,
    title: input.title?.trim() || null,
    startTime: input.startTime ?? null,
    workspaceHint: input.workspaceHint?.trim() || null,
    workspaceId: hintedWorkspaceId,
    notesGenerated,
  };

  if (meeting) {
    const hasNotes = (meeting.notesGenerated ?? "").trim().length > 0;
    if (hasNotes) {
      // The body is dropped from the meeting but kept in the log, so the
      // push can still be re-associated from Settings → Ingest log.
      await db.insert(ingestEvents).values({
        ...logBase,
        outcome: "matched_not_written",
        matchedMeetingId: meeting.id,
        meetingId: meeting.id,
      });
      return { matched: true, meetingId: meeting.id, written: false };
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(meetings)
        .set({
          notesGenerated,
          notesGeneratedUpdatedAt: now,
          updatedAt: now,
        })
        .where(eq(meetings.id, meeting.id));
      await tx.insert(ingestEvents).values({
        ...logBase,
        outcome: "matched_written",
        matchedMeetingId: meeting.id,
        meetingId: meeting.id,
      });
    });
    return { matched: true, meetingId: meeting.id, written: true };
  }

  const now = new Date();
  const [pending] = await db
    .insert(pendingIngests)
    .values({
      sourceId,
      title: input.title?.trim() || "(untitled)",
      startTime: input.startTime ?? null,
      notesGenerated,
      workspaceId: hintedWorkspaceId,
      workspaceHint: input.workspaceHint?.trim() || null,
    })
    .onConflictDoUpdate({
      target: pendingIngests.sourceId,
      set: {
        title: input.title?.trim() || "(untitled)",
        startTime: input.startTime ?? null,
        notesGenerated,
        workspaceId: hintedWorkspaceId,
        workspaceHint: input.workspaceHint?.trim() || null,
        updatedAt: now,
      },
    })
    .returning();
  await db.insert(ingestEvents).values({ ...logBase, outcome: "pending" });
  return { matched: false, pending: true, pendingId: pending.id };
}

export type PendingIngestWithWorkspace = PendingIngest & {
  // Resolved tag's current name (null = untagged / workspace since deleted).
  workspaceName: string | null;
};

export async function listPendingIngests(): Promise<
  PendingIngestWithWorkspace[]
> {
  const rows = await db
    .select({ pending: pendingIngests, workspaceName: workspaces.name })
    .from(pendingIngests)
    .leftJoin(workspaces, eq(workspaces.id, pendingIngests.workspaceId))
    .orderBy(desc(pendingIngests.createdAt));
  return rows.map((r) => ({ ...r.pending, workspaceName: r.workspaceName }));
}

export async function countPendingIngests(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(pendingIngests);
  return row?.n ?? 0;
}

// Attach a pending ingest's notes to an existing meeting and remember the
// source id (external_ref) so future pushes auto-match.
export async function matchPendingToMeeting(
  pendingId: string,
  meetingId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(pendingIngests)
      .where(eq(pendingIngests.id, pendingId))
      .limit(1);
    if (!pending) return false;
    const now = new Date();
    await tx
      .update(meetings)
      .set({
        notesGenerated: pending.notesGenerated,
        notesGeneratedUpdatedAt: now,
        externalRef: pending.sourceId,
        updatedAt: now,
      })
      .where(eq(meetings.id, meetingId));
    await tx.delete(pendingIngests).where(eq(pendingIngests.id, pendingId));
    await settleLogRows(tx, pending.sourceId, meetingId);
    return true;
  });
}

// Create a brand-new meeting from a pending ingest. The push's workspace tag
// wins when present; otherwise the caller's fallback (the active workspace at
// review time) applies.
export async function createMeetingFromPending(
  fallbackWorkspaceId: string,
  pendingId: string,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [pending] = await tx
      .select()
      .from(pendingIngests)
      .where(eq(pendingIngests.id, pendingId))
      .limit(1);
    if (!pending) return null;
    const now = new Date();
    const [meeting] = await tx
      .insert(meetings)
      .values({
        workspaceId: pending.workspaceId ?? fallbackWorkspaceId,
        title: pending.title,
        startTime: pending.startTime ?? now,
        notesGenerated: pending.notesGenerated,
        notesGeneratedUpdatedAt: now,
        externalRef: pending.sourceId,
        source: "manual",
      })
      .returning({ id: meetings.id });
    await tx.delete(pendingIngests).where(eq(pendingIngests.id, pendingId));
    await settleLogRows(tx, pending.sourceId, meeting.id);
    return meeting.id;
  });
}

export async function discardPendingIngest(id: string): Promise<void> {
  await db.delete(pendingIngests).where(eq(pendingIngests.id, id));
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Reviewing a pending push resolves every still-unassociated log row for that
// sourceId (re-pushes upsert one inbox item but log one row each).
async function settleLogRows(tx: Tx, sourceId: string, meetingId: string) {
  await tx
    .update(ingestEvents)
    .set({ meetingId })
    .where(
      and(eq(ingestEvents.sourceId, sourceId), isNull(ingestEvents.meetingId)),
    );
}

// Called by moveGeneratedNotes so the log follows notes moved via the day
// view / meeting header, not just via the log's own re-associate.
export async function repointLogRows(fromMeetingId: string, toMeetingId: string) {
  await db
    .update(ingestEvents)
    .set({ meetingId: toMeetingId, reassignedAt: new Date() })
    .where(eq(ingestEvents.meetingId, fromMeetingId));
}

// ---- Ingest log (Settings → Ingest log) ----

export type IngestEventMeeting = {
  id: string;
  title: string;
  startTime: Date;
  skipped: boolean;
  // Exact-title hide rule in the meeting's workspace — hidden from the
  // calendar list, which is the usual way a push "vanishes".
  hidden: boolean;
  workspaceId: string;
  workspaceName: string | null;
  // Whether the meeting currently holds THIS push's body verbatim.
  holdsBody: boolean;
  hasGenerated: boolean;
};

export type IngestEventRow = IngestEvent & {
  workspaceName: string | null;
  meeting: IngestEventMeeting | null;
  // Where it landed at push time, when that differs from the current meeting.
  matchedMeeting: Pick<IngestEventMeeting, "id" | "title" | "startTime"> | null;
  // A pending inbox item for this sourceId still exists.
  stillPending: boolean;
};

export const INGEST_LOG_LIMIT = 200;

export async function listIngestEvents(
  limit = INGEST_LOG_LIMIT,
): Promise<IngestEventRow[]> {
  const events = await db
    .select({ event: ingestEvents, workspaceName: workspaces.name })
    .from(ingestEvents)
    .leftJoin(workspaces, eq(workspaces.id, ingestEvents.workspaceId))
    .orderBy(desc(ingestEvents.createdAt))
    .limit(limit);
  if (events.length === 0) return [];

  const meetingIds = Array.from(
    new Set(
      events.flatMap((e) =>
        [e.event.meetingId, e.event.matchedMeetingId].filter(
          (id): id is string => !!id,
        ),
      ),
    ),
  );
  const sourceIds = Array.from(new Set(events.map((e) => e.event.sourceId)));

  const [meetingRows, pendingRows] = await Promise.all([
    meetingIds.length
      ? db
          .select({
            id: meetings.id,
            title: meetings.title,
            startTime: meetings.startTime,
            skipped: meetings.skipped,
            workspaceId: meetings.workspaceId,
            workspaceName: workspaces.name,
            notesGenerated: meetings.notesGenerated,
            hidden: sql<boolean>`EXISTS (
              SELECT 1 FROM ${hiddenMeetingTitles} h
              WHERE h.workspace_id = ${meetings.workspaceId}
                AND h.title = ${meetings.title}
            )`,
          })
          .from(meetings)
          .leftJoin(workspaces, eq(workspaces.id, meetings.workspaceId))
          .where(inArray(meetings.id, meetingIds))
      : Promise.resolve([]),
    db
      .select({ sourceId: pendingIngests.sourceId })
      .from(pendingIngests)
      .where(inArray(pendingIngests.sourceId, sourceIds)),
  ]);
  const byId = new Map(meetingRows.map((m) => [m.id, m]));
  const pendingSet = new Set(pendingRows.map((p) => p.sourceId));

  return events.map(({ event, workspaceName }) => {
    const cur = event.meetingId ? byId.get(event.meetingId) : undefined;
    const orig =
      event.matchedMeetingId && event.matchedMeetingId !== event.meetingId
        ? byId.get(event.matchedMeetingId)
        : undefined;
    return {
      ...event,
      workspaceName,
      meeting: cur
        ? {
            id: cur.id,
            title: cur.title,
            startTime: cur.startTime,
            skipped: cur.skipped,
            hidden: cur.hidden,
            workspaceId: cur.workspaceId,
            workspaceName: cur.workspaceName,
            holdsBody: cur.notesGenerated === event.notesGenerated,
            hasGenerated: (cur.notesGenerated ?? "").trim().length > 0,
          }
        : null,
      matchedMeeting: orig
        ? { id: orig.id, title: orig.title, startTime: orig.startTime }
        : null,
      stillPending: pendingSet.has(event.sourceId),
    };
  });
}

export type ReassociateResult =
  | { ok: true; meetingId: string }
  | {
      ok: false;
      reason: "not-found" | "same-meeting" | "target-occupied";
    };

// Put a logged push onto a different meeting, writing the body FROM THE LOG
// (the previously associated meeting may never have received it, or may have
// been edited since). The old meeting is cleared only if it still holds this
// push's body verbatim, so hand edits are never destroyed; its external_ref
// is released either way so the next push follows the new association.
export async function reassociateIngestEvent(
  eventId: string,
  targetMeetingId: string,
): Promise<ReassociateResult> {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(ingestEvents)
      .where(eq(ingestEvents.id, eventId))
      .limit(1);
    if (!event) return { ok: false, reason: "not-found" };
    if (event.meetingId === targetMeetingId) {
      return { ok: false, reason: "same-meeting" };
    }
    const [target] = await tx
      .select()
      .from(meetings)
      .where(eq(meetings.id, targetMeetingId))
      .limit(1);
    if (!target) return { ok: false, reason: "not-found" };
    if ((target.notesGenerated ?? "").trim().length > 0) {
      return { ok: false, reason: "target-occupied" };
    }
    await applyReassociation(tx, event, targetMeetingId);
    return { ok: true, meetingId: targetMeetingId };
  });
}

// Same, onto a brand-new manual meeting built from the push's own metadata.
// Workspace: the one the user picked (if any) > the push's resolved hint >
// the caller's fallback (the active workspace).
export async function reassociateIngestEventToNew(
  eventId: string,
  fallbackWorkspaceId: string,
  chosenWorkspaceId: string | null = null,
): Promise<ReassociateResult> {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(ingestEvents)
      .where(eq(ingestEvents.id, eventId))
      .limit(1);
    if (!event) return { ok: false, reason: "not-found" };
    const [created] = await tx
      .insert(meetings)
      .values({
        workspaceId:
          chosenWorkspaceId ?? event.workspaceId ?? fallbackWorkspaceId,
        title: event.title?.trim() || "(untitled)",
        startTime: event.startTime ?? event.createdAt,
        source: "manual",
      })
      .returning({ id: meetings.id });
    await applyReassociation(tx, event, created.id);
    return { ok: true, meetingId: created.id };
  });
}

async function applyReassociation(
  tx: Tx,
  event: IngestEvent,
  targetMeetingId: string,
) {
  const now = new Date();
  // Stamped a millisecond newer than anything the old row gets, so the
  // updated_at tie-break also favours the target (belt and braces next to
  // the external_ref ordering in ingestGeneratedNotes).
  const targetNow = new Date(now.getTime() + 1);
  if (event.meetingId) {
    const [old] = await tx
      .select({
        notesGenerated: meetings.notesGenerated,
        externalRef: meetings.externalRef,
      })
      .from(meetings)
      .where(eq(meetings.id, event.meetingId))
      .limit(1);
    if (old) {
      const clearNotes = old.notesGenerated === event.notesGenerated;
      const clearRef = old.externalRef === event.sourceId;
      if (clearNotes || clearRef) {
        await tx
          .update(meetings)
          .set({
            ...(clearNotes
              ? { notesGenerated: null, notesGeneratedUpdatedAt: null }
              : {}),
            ...(clearRef ? { externalRef: null } : {}),
            updatedAt: now,
          })
          .where(eq(meetings.id, event.meetingId));
      }
    }
  }
  await tx
    .update(meetings)
    .set({
      notesGenerated: event.notesGenerated,
      notesGeneratedUpdatedAt: targetNow,
      externalRef: event.sourceId,
      updatedAt: targetNow,
    })
    .where(eq(meetings.id, targetMeetingId));
  // The push is resolved; an inbox item for it would only re-ask.
  await tx
    .delete(pendingIngests)
    .where(eq(pendingIngests.sourceId, event.sourceId));
  await tx
    .update(ingestEvents)
    .set({ meetingId: targetMeetingId, reassignedAt: now })
    .where(eq(ingestEvents.id, event.id));
  // Re-pushes of the same sourceId that were still unassociated are resolved
  // by this too — same as reviewing the inbox item would have.
  await settleLogRows(tx, event.sourceId, targetMeetingId);
}
