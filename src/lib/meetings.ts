import "server-only";
import { and, asc, desc, eq, lt, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  meetings,
  hiddenMeetingTitles,
  type Attendee,
  type Meeting,
  type NewMeeting,
} from "@/db/schema";
import { APP_TIMEZONE } from "./dates";

// Meetings on the given calendar date (app tz), excluding skipped occurrences and
// any whose title matches a "Hide" rule that was created on/before that date.
export async function getMeetingsForDate(
  workspaceId: string,
  dateStr: string,
): Promise<Meeting[]> {
  return db
    .select()
    .from(meetings)
    .where(
      sql`${meetings.workspaceId} = ${workspaceId}
        AND (${meetings.startTime} AT TIME ZONE ${APP_TIMEZONE})::date = ${dateStr}::date
        AND ${meetings.skipped} = false
        AND NOT EXISTS (
          SELECT 1 FROM ${hiddenMeetingTitles} h
          WHERE h.title = ${meetings.title}
          AND h.workspace_id = ${workspaceId}
          AND (h.created_at AT TIME ZONE ${APP_TIMEZONE})::date <= ${dateStr}::date
        )`,
    )
    .orderBy(asc(meetings.startTime));
}

// Meetings whose start falls inside [startDate, endDate] (app-tz calendar
// days, inclusive), with the same skipped/hidden-title exclusions as the day
// view — feeds the Reports "Meeting load" chart.
export async function getMeetingsInRange(
  workspaceId: string,
  startDate: string,
  endDate: string,
): Promise<
  (Pick<Meeting, "id" | "title" | "startTime" | "endTime" | "projectId"> & {
    // Computed in SQL so a month of full note bodies never crosses the wire.
    hasNotes: boolean;
    hasGenerated: boolean;
  })[]
> {
  return db
    .select({
      id: meetings.id,
      title: meetings.title,
      startTime: meetings.startTime,
      endTime: meetings.endTime,
      projectId: meetings.projectId,
      hasNotes: sql<boolean>`length(trim(${meetings.notes})) > 0`,
      hasGenerated: sql<boolean>`length(trim(coalesce(${meetings.notesGenerated}, ''))) > 0`,
    })
    .from(meetings)
    .where(
      sql`${meetings.workspaceId} = ${workspaceId}
        AND (${meetings.startTime} AT TIME ZONE ${APP_TIMEZONE})::date
          BETWEEN ${startDate}::date AND ${endDate}::date
        AND ${meetings.skipped} = false
        AND NOT EXISTS (
          SELECT 1 FROM ${hiddenMeetingTitles} h
          WHERE h.title = ${meetings.title}
          AND h.workspace_id = ${workspaceId}
        )`,
    )
    .orderBy(asc(meetings.startTime));
}

export async function skipMeeting(id: string): Promise<void> {
  await db
    .update(meetings)
    .set({ skipped: true, updatedAt: new Date() })
    .where(eq(meetings.id, id));
}

export async function unskipMeeting(id: string): Promise<void> {
  await db
    .update(meetings)
    .set({ skipped: false, updatedAt: new Date() })
    .where(eq(meetings.id, id));
}

// Permanently delete a meeting (its action_items cascade via FK). Calendar events
// would just re-import, so the API restricts this to manual ("custom") meetings.
export async function deleteMeeting(id: string): Promise<void> {
  await db.delete(meetings).where(eq(meetings.id, id));
}

// Earlier occurrences of the same-titled meeting (for the "Past meetings" view),
// newest first. Builds up over time as recurring meetings are imported each day.
export async function listPastMeetingsByTitle(
  workspaceId: string,
  title: string,
  currentId: string,
  before: Date,
): Promise<Meeting[]> {
  return db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.workspaceId, workspaceId),
        eq(meetings.title, title),
        lt(meetings.startTime, before),
        ne(meetings.id, currentId),
      ),
    )
    .orderBy(desc(meetings.startTime))
    .limit(50);
}

export async function listSkippedMeetings(
  workspaceId: string,
): Promise<Meeting[]> {
  return db
    .select()
    .from(meetings)
    .where(and(eq(meetings.workspaceId, workspaceId), eq(meetings.skipped, true)))
    .orderBy(desc(meetings.startTime));
}

// "Hide": create an exact-title rule (idempotent on title).
export async function addHiddenTitle(
  workspaceId: string,
  title: string,
): Promise<void> {
  await db
    .insert(hiddenMeetingTitles)
    .values({ workspaceId, title })
    .onConflictDoNothing({
      target: [hiddenMeetingTitles.workspaceId, hiddenMeetingTitles.title],
    });
}

export async function listHiddenTitles(workspaceId: string) {
  return db
    .select()
    .from(hiddenMeetingTitles)
    .where(eq(hiddenMeetingTitles.workspaceId, workspaceId))
    .orderBy(desc(hiddenMeetingTitles.createdAt));
}

export async function removeHiddenTitle(id: string): Promise<void> {
  await db.delete(hiddenMeetingTitles).where(eq(hiddenMeetingTitles.id, id));
}

export async function getMeeting(id: string): Promise<Meeting | undefined> {
  const [m] = await db.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  return m;
}

export async function createMeeting(
  workspaceId: string,
  input: {
    title: string;
    startTime: Date;
    endTime?: Date | null;
  },
): Promise<Meeting> {
  const values: NewMeeting = {
    workspaceId,
    title: input.title,
    startTime: input.startTime,
    endTime: input.endTime ?? null,
    source: "manual",
  };
  const [m] = await db.insert(meetings).values(values).returning();
  return m;
}

// Update notes with an optimistic-concurrency check. `baseNotesUpdatedAt` is the
// notes_updated_at the client last saw; if the row moved on (edited from another
// device), we return a conflict instead of clobbering.
export type SaveNotesResult =
  | { ok: true; notesUpdatedAt: Date }
  | { ok: false; conflict: true; notes: string; notesUpdatedAt: Date };

export async function saveMeetingNotes(
  id: string,
  notes: string,
  baseNotesUpdatedAt: Date | null,
): Promise<SaveNotesResult | null> {
  const current = await getMeeting(id);
  if (!current) return null;

  if (
    baseNotesUpdatedAt &&
    current.notesUpdatedAt.getTime() > baseNotesUpdatedAt.getTime()
  ) {
    return {
      ok: false,
      conflict: true,
      notes: current.notes,
      notesUpdatedAt: current.notesUpdatedAt,
    };
  }

  const now = new Date();
  await db
    .update(meetings)
    .set({ notes, notesUpdatedAt: now, updatedAt: now })
    .where(eq(meetings.id, id));
  return { ok: true, notesUpdatedAt: now };
}

// Upsert a calendar event keyed by calendar_event_id. Idempotent: re-importing
// updates title/time/attendees but NEVER touches notes or notes_updated_at.
// Exception: a user-renamed title (title_edited_at set) is pinned — re-import
// keeps the rename and only refreshes the other fields.
export type CalendarUpsert = {
  calendarEventId: string;
  title: string;
  description: string | null;
  startTime: Date;
  endTime: Date | null;
  attendees: Attendee[];
};

export async function upsertCalendarMeetings(
  workspaceId: string,
  events: CalendarUpsert[],
): Promise<number> {
  if (events.length === 0) return 0;
  const now = new Date();
  await db
    .insert(meetings)
    .values(
      events.map((e) => ({
        workspaceId,
        calendarEventId: e.calendarEventId,
        title: e.title,
        description: e.description,
        startTime: e.startTime,
        endTime: e.endTime,
        attendees: e.attendees,
        source: "calendar" as const,
      })),
    )
    .onConflictDoUpdate({
      target: [meetings.workspaceId, meetings.calendarEventId],
      set: {
        // A user-renamed title (title_edited_at set) is pinned: re-import keeps it.
        title: sql`CASE WHEN ${meetings.titleEditedAt} IS NOT NULL THEN ${meetings.title} ELSE excluded.title END`,
        description: sql`excluded.description`,
        startTime: sql`excluded.start_time`,
        endTime: sql`excluded.end_time`,
        attendees: sql`excluded.attendees`,
        source: sql`excluded.source`,
        updatedAt: now,
        // notes + notes_updated_at intentionally left untouched.
      },
    });
  return events.length;
}

export async function updateGeneratedNotes(
  id: string,
  notesGenerated: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(meetings)
    .set({ notesGenerated, notesGeneratedUpdatedAt: now, updatedAt: now })
    .where(eq(meetings.id, id));
}

export async function updateMeetingMeta(
  id: string,
  input: {
    title?: string;
    startTime?: Date;
    endTime?: Date | null;
    projectId?: string | null;
    untaggedDismissedAt?: Date;
  },
): Promise<Meeting | undefined> {
  const set: Partial<NewMeeting> = { updatedAt: new Date() };
  if (input.title !== undefined) {
    set.title = input.title;
    // Pin the title against ICS re-import — but only on a real change, so a
    // client round-tripping an unchanged title doesn't detach the meeting
    // from its feed.
    set.titleEditedAt = sql`CASE WHEN ${meetings.title} <> ${input.title} THEN now() ELSE ${meetings.titleEditedAt} END` as unknown as Date;
  }
  if (input.startTime !== undefined) set.startTime = input.startTime;
  if (input.endTime !== undefined) set.endTime = input.endTime;
  if (input.projectId !== undefined) set.projectId = input.projectId;
  if (input.untaggedDismissedAt !== undefined) {
    set.untaggedDismissedAt = input.untaggedDismissedAt;
  }
  const [m] = await db
    .update(meetings)
    .set(set)
    .where(eq(meetings.id, id))
    .returning();
  return m;
}
