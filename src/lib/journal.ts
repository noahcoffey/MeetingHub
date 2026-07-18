import "server-only";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  journalEntries,
  journalStatValues,
  type JournalEntry,
} from "@/db/schema";

export type SaveNotesResult =
  | { ok: true; notesUpdatedAt: Date }
  | { ok: false; conflict: true; notes: string; notesUpdatedAt: Date };

// One entry per day. Created on first open so the page always has a stable id to
// hang notes + action items off of.
export async function getOrCreateEntry(
  workspaceId: string,
  dateStr: string,
): Promise<JournalEntry> {
  // Insert-if-absent, then read back (handles the race without a unique-violation throw).
  await db
    .insert(journalEntries)
    .values({ workspaceId, entryDate: dateStr })
    .onConflictDoNothing({
      target: [journalEntries.workspaceId, journalEntries.entryDate],
    });
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        eq(journalEntries.entryDate, dateStr),
      ),
    );
  return entry;
}

export async function getEntryById(id: string): Promise<JournalEntry | undefined> {
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.id, id));
  return entry;
}

// Mirrors saveMeetingNotes: optimistic-concurrency check against notes_updated_at.
export async function saveJournalNotes(
  id: string,
  notes: string,
  baseNotesUpdatedAt: Date | null,
): Promise<SaveNotesResult | null> {
  const current = await getEntryById(id);
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
    .update(journalEntries)
    .set({ notes, notesUpdatedAt: now, updatedAt: now })
    .where(eq(journalEntries.id, id));
  return { ok: true, notesUpdatedAt: now };
}

// Bump updatedAt when a stat value changes, so the entry's "touched" time tracks
// stat edits too (the stat values themselves live in journal_stat_values).
export async function touchEntry(id: string): Promise<void> {
  await db
    .update(journalEntries)
    .set({ updatedAt: new Date() })
    .where(eq(journalEntries.id, id));
}

// Entries within an inclusive [startDate, endDate] window, oldest first — for reports.
export async function getEntriesInRange(
  workspaceId: string,
  startDate: string,
  endDate: string,
): Promise<JournalEntry[]> {
  return db
    .select()
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        gte(journalEntries.entryDate, startDate),
        lte(journalEntries.entryDate, endDate),
      ),
    )
    .orderBy(asc(journalEntries.entryDate));
}

// Days that already have content (for marking them in navigation later). Unused now
// but cheap to keep alongside the data layer.
export async function listEntryDatesWithContent(
  workspaceId: string,
): Promise<string[]> {
  const rows = await db
    .select({ entryDate: journalEntries.entryDate })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        sql`(length(${journalEntries.notes}) > 0
          OR EXISTS (
            SELECT 1 FROM ${journalStatValues} v
            WHERE v.journal_entry_id = ${journalEntries.id}
          ))`,
      ),
    );
  return rows.map((r) => r.entryDate);
}
