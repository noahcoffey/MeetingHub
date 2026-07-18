import "server-only";
import { count, desc, eq, or, sql } from "drizzle-orm";
// Ingest matching is GLOBAL across workspaces — calendar UIDs are unique per
// feed in practice, so an exact sourceId match is trusted wherever it lives.
// The optional `workspace` hint (the source app sends its own workspace name)
// breaks ties toward that workspace and routes UNMATCHED pushes: the pending
// row is pre-tagged so review lands it in the right place.
import { db } from "@/db";
import {
  meetings,
  pendingIngests,
  workspaces,
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
    .orderBy(
      ...(hintedWorkspaceId
        ? [sql`(${meetings.workspaceId} = ${hintedWorkspaceId}) DESC`]
        : []),
      desc(meetings.updatedAt),
    )
    .limit(1);

  if (meeting) {
    const hasNotes = (meeting.notesGenerated ?? "").trim().length > 0;
    if (hasNotes) {
      return { matched: true, meetingId: meeting.id, written: false };
    }
    const now = new Date();
    await db
      .update(meetings)
      .set({
        notesGenerated,
        notesGeneratedUpdatedAt: now,
        updatedAt: now,
      })
      .where(eq(meetings.id, meeting.id));
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
    return meeting.id;
  });
}

export async function discardPendingIngest(id: string): Promise<void> {
  await db.delete(pendingIngests).where(eq(pendingIngests.id, id));
}
