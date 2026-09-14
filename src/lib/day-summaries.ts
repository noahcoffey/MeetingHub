import "server-only";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { daySummaries, type DaySummary } from "@/db/schema";
import { getMeetingsForDate } from "./meetings";
import {
  computeDayStats,
  computeInputFingerprint,
  type DayStats,
} from "./day-summary-input";

// Storage and serving for the Day Summary. Generation happens OUTSIDE the app,
// in the local runner at tools/day-summary — the app has no LLM dependency and
// no scheduler, exactly as for the weekly Sunday Summary.
//
// A day summary aggregates the most sensitive content a workspace holds (1:1s,
// candid assessments), so it is scoped and gated exactly like the meetings it
// is built from: workspace FK `restrict` and the `meetings` feature toggle.

// Everything but the two bodies — the list surface, mirroring listWeeklySummaries.
export type DaySummaryMeta = Omit<DaySummary, "markdown" | "markdownEdited">;

const metaColumns = {
  id: daySummaries.id,
  workspaceId: daySummaries.workspaceId,
  day: daySummaries.day,
  model: daySummaries.model,
  generatedAt: daySummaries.generatedAt,
  inputFingerprint: daySummaries.inputFingerprint,
  createdAt: daySummaries.createdAt,
  updatedAt: daySummaries.updatedAt,
};

export async function listDaySummaries(
  workspaceId: string,
  range?: { from?: string; to?: string },
): Promise<DaySummaryMeta[]> {
  const where = [eq(daySummaries.workspaceId, workspaceId)];
  if (range?.from) where.push(gte(daySummaries.day, range.from));
  if (range?.to) where.push(lte(daySummaries.day, range.to));
  return db
    .select(metaColumns)
    .from(daySummaries)
    .where(and(...where))
    .orderBy(desc(daySummaries.day));
}

export async function getDaySummaryById(
  id: string,
): Promise<DaySummary | undefined> {
  const [row] = await db
    .select()
    .from(daySummaries)
    .where(eq(daySummaries.id, id))
    .limit(1);
  return row;
}

export async function getDaySummaryForDay(
  workspaceId: string,
  day: string,
): Promise<DaySummary | undefined> {
  const [row] = await db
    .select()
    .from(daySummaries)
    .where(
      and(eq(daySummaries.workspaceId, workspaceId), eq(daySummaries.day, day)),
    )
    .limit(1);
  return row;
}

/**
 * Upsert one day's summary, keyed `(workspaceId, day)` — the runner can re-run
 * safely and never creates a second summary for a day. `created` distinguishes
 * 201 from 200, like upsertWeeklySummary.
 *
 * **Only `markdown` is written.** A hand-edited `markdownEdited` survives a
 * re-push untouched and keeps rendering; there is no DELETE endpoint here, so
 * silently overwriting an edit would be unrecoverable.
 *
 * **`inputFingerprint` is taken from the caller, not recomputed.** The runner
 * reads the context, spends minutes in the model, then pushes. Recomputing here
 * would describe the inputs as they are *now* — so a note that landed while the
 * model was writing would look accounted for, and the summary would silently
 * not be flagged stale. Callers without a fingerprint (a hand-rolled curl) fall
 * back to computing one, which is the best that can be done for them.
 */
export async function upsertDaySummary(
  workspaceId: string,
  input: {
    day: string;
    markdown: string;
    model?: string | null;
    generatedAt?: Date;
    inputFingerprint?: string;
  },
): Promise<{ item: DaySummary; created: boolean }> {
  const fingerprint =
    input.inputFingerprint ??
    computeInputFingerprint(await getMeetingsForDate(workspaceId, input.day));
  const existing = await getDaySummaryForDay(workspaceId, input.day);
  const generatedAt = input.generatedAt ?? new Date();
  const model = input.model ?? null;
  const now = new Date();

  if (existing) {
    const [item] = await db
      .update(daySummaries)
      .set({
        markdown: input.markdown,
        model,
        generatedAt,
        inputFingerprint: fingerprint,
        updatedAt: now,
      })
      .where(eq(daySummaries.id, existing.id))
      .returning();
    return { item, created: false };
  }
  const [item] = await db
    .insert(daySummaries)
    .values({
      workspaceId,
      day: input.day,
      markdown: input.markdown,
      model,
      generatedAt,
      inputFingerprint: fingerprint,
    })
    .returning();
  return { item, created: true };
}

/**
 * Edit the body, or reset back to the generated original.
 *
 * Writes `markdownEdited` only — the pushed `markdown` is never touched from
 * here, so "Reset to generated" always has something to go back to. Passing
 * text identical to the generated body clears the edit rather than storing a
 * duplicate.
 */
export async function editDaySummary(
  id: string,
  markdownEdited: string | null,
): Promise<DaySummary | undefined> {
  const existing = await getDaySummaryById(id);
  if (!existing) return undefined;
  const next =
    markdownEdited === null || markdownEdited.trim() === existing.markdown.trim()
      ? null
      : markdownEdited;
  const [row] = await db
    .update(daySummaries)
    .set({ markdownEdited: next, updatedAt: new Date() })
    .where(eq(daySummaries.id, id))
    .returning();
  return row;
}

// ---- day-view state ----

export type DaySummaryView = {
  summary: DaySummary | null;
  /** Inputs changed since the summary was written. Never auto-refreshed. */
  stale: boolean;
  /** The user has hand-edited the body; `markdownEdited` is what renders. */
  edited: boolean;
  /** Some meeting that day has manual or generated notes. */
  hasNotes: boolean;
  stats: DayStats;
};

/**
 * Everything the day view needs, in one pass over the day's meetings.
 *
 * The meeting set comes from `getMeetingsForDate` — the *same* query the day
 * view lists — so the summary can never cover a different set of meetings than
 * the page it appears on.
 */
export async function getDaySummaryView(
  workspaceId: string,
  day: string,
): Promise<DaySummaryView> {
  const [meetings, row] = await Promise.all([
    getMeetingsForDate(workspaceId, day),
    getDaySummaryForDay(workspaceId, day),
  ]);
  const stats = computeDayStats(meetings);

  return {
    summary: row ?? null,
    stale: !!row && row.inputFingerprint !== computeInputFingerprint(meetings),
    edited: !!row?.markdownEdited,
    hasNotes: stats.meetingCount > 0,
    stats,
  };
}

/** What the view renders: the hand-edited body when there is one. */
export function daySummaryBody(row: DaySummary): string {
  return row.markdownEdited ?? row.markdown;
}
