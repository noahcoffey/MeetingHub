import "server-only";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { daySummaries, type DaySummary } from "@/db/schema";
import { getMeetingsForDate } from "./meetings";
import { formatDateLabel } from "./dates";
import {
  computeDayStats,
  computeInputFingerprint,
  notedMeetings,
  type DayStats,
} from "./day-summary-input";
import { buildDaySummaryPrompt } from "./day-summary-prompt";
import {
  DAY_SUMMARY_MODEL,
  DaySummaryNotConfiguredError,
  generateWithClaude,
  isDaySummaryConfigured,
  type DaySummaryGenerator,
} from "./day-summary-model";

// A Day Summary is a synthesis across one day's meeting notes. It aggregates
// the most sensitive content a workspace holds (1:1s, candid assessments), so
// it is scoped and gated exactly like the meetings it is built from: workspace
// FK `restrict`, the `meetings` feature toggle, and the same auth surfaces.

// A `generating` row older than this is assumed dead (a crashed or redeployed
// server) and reads as failed, so a stuck row never blocks regeneration.
export const GENERATING_TIMEOUT_MS = 10 * 60 * 1000;

// Everything but the two bodies — the list surface, mirroring listWeeklySummaries.
export type DaySummaryMeta = Omit<DaySummary, "markdown" | "markdownEdited">;

const metaColumns = {
  id: daySummaries.id,
  workspaceId: daySummaries.workspaceId,
  day: daySummaries.day,
  model: daySummaries.model,
  generatedAt: daySummaries.generatedAt,
  inputFingerprint: daySummaries.inputFingerprint,
  status: daySummaries.status,
  error: daySummaries.error,
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

/** The live status, with a dead `generating` row downgraded to `failed`. */
export function liveStatus(
  row: DaySummary | undefined,
): "none" | "generating" | "ready" | "failed" {
  if (!row) return "none";
  return isStuckGenerating(row) ? "failed" : row.status;
}

/** A `generating` row this old is treated as dead — see GENERATING_TIMEOUT_MS. */
export function isStuckGenerating(row: DaySummary, now = Date.now()): boolean {
  return (
    row.status === "generating" &&
    now - row.updatedAt.getTime() > GENERATING_TIMEOUT_MS
  );
}

// ---- day-view state ----

export type DaySummaryView = {
  summary: DaySummary | null;
  /** Live status, with a dead `generating` row downgraded to `failed`. */
  status: "none" | "generating" | "ready" | "failed";
  /** Inputs changed since generation. Never auto-regenerates — §6. */
  stale: boolean;
  /** The user has hand-edited the body; `markdownEdited` is what renders. */
  edited: boolean;
  /** Some meeting that day has manual or generated notes. */
  hasNotes: boolean;
  /** The model call is wired up (ANTHROPIC_API_KEY present). */
  configured: boolean;
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
  const hasNotes = stats.meetingCount > 0;
  const fingerprint = computeInputFingerprint(meetings);

  const status = liveStatus(row);

  return {
    summary: row ?? null,
    status,
    // Only a finished summary can be stale — a failed or in-flight one has
    // nothing to compare against yet.
    stale: !!row && status === "ready" && row.inputFingerprint !== fingerprint,
    edited: !!row?.markdownEdited,
    hasNotes,
    configured: isDaySummaryConfigured(),
    stats,
  };
}

/** What the view renders: the hand-edited body when there is one. */
export function daySummaryBody(row: DaySummary): string {
  return row.markdownEdited ?? row.markdown;
}

// ---- generation ----

export type GenerateResult =
  | { ok: true; item: DaySummary; created: boolean }
  | {
      ok: false;
      reason: "no-notes" | "in-flight" | "not-configured" | "failed";
      message: string;
    };

/**
 * Generate (or regenerate) the summary for one day.
 *
 * Idempotent per (workspace, day): there is exactly one row per day and this
 * always upserts into it — regenerating never creates a second summary.
 *
 * §7 — **regeneration only ever writes `markdown`.** A hand-edited
 * `markdownEdited` survives untouched, and the view keeps rendering it while
 * offering the freshly generated original alongside. There is no DELETE
 * endpoint in this API, so silently overwriting an edit would be unrecoverable.
 *
 * The model call is awaited inline: single-user, self-hosted, and the row is
 * flipped to `generating` first so a reload mid-flight shows progress rather
 * than an empty state.
 */
export async function generateDaySummary(
  workspaceId: string,
  day: string,
  opts: { generate?: DaySummaryGenerator } = {},
): Promise<GenerateResult> {
  const generate = opts.generate ?? generateWithClaude;

  const meetings = await getMeetingsForDate(workspaceId, day);
  const noted = notedMeetings(meetings);
  if (noted.length === 0) {
    // §4: never call the model when there is nothing to summarize.
    return {
      ok: false,
      reason: "no-notes",
      message: "No meeting on this day has notes to summarize.",
    };
  }
  if (!opts.generate && !isDaySummaryConfigured()) {
    return {
      ok: false,
      reason: "not-configured",
      message: "Day summaries are not configured (ANTHROPIC_API_KEY is unset).",
    };
  }

  const existing = await getDaySummaryForDay(workspaceId, day);
  if (existing && existing.status === "generating" && !isStuckGenerating(existing)) {
    return {
      ok: false,
      reason: "in-flight",
      message: "A summary for this day is already being generated.",
    };
  }

  const fingerprint = computeInputFingerprint(meetings);
  const now = new Date();
  const [claimed] = existing
    ? await db
        .update(daySummaries)
        .set({ status: "generating", error: null, updatedAt: now })
        .where(eq(daySummaries.id, existing.id))
        .returning()
    : await db
        .insert(daySummaries)
        .values({ workspaceId, day, status: "generating" })
        .returning();

  try {
    const prompt = buildDaySummaryPrompt(formatDateLabel(day), meetings);
    const { markdown, model } = await generate(prompt);
    const [item] = await db
      .update(daySummaries)
      .set({
        markdown,
        model,
        generatedAt: new Date(),
        inputFingerprint: fingerprint,
        status: "ready",
        error: null,
        updatedAt: new Date(),
      })
      .where(eq(daySummaries.id, claimed.id))
      .returning();
    return { ok: true, item, created: !existing };
  } catch (e) {
    // The message is operator-facing and must never carry note content, so only
    // known error shapes are surfaced.
    const message =
      e instanceof DaySummaryNotConfiguredError
        ? "Day summaries are not configured (ANTHROPIC_API_KEY is unset)."
        : e instanceof Error && e.message
          ? e.message
          : "Generation failed.";
    console.error(`[day-summary] generation failed for ${day}: ${message}`);
    await db
      .update(daySummaries)
      .set({ status: "failed", error: message, updatedAt: new Date() })
      .where(eq(daySummaries.id, claimed.id));
    return { ok: false, reason: "failed", message };
  }
}

/**
 * Edit the body, or reset back to the generated original.
 *
 * Writes `markdownEdited` only — the generated `markdown` is never touched from
 * here, so "Reset to generated" (passing null) always has something to go back
 * to. Passing text identical to the generated body clears the edit rather than
 * storing a duplicate.
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

// Days in a range that already have a summary — lets a future month/list view
// flag them without fetching bodies.
export async function listDaySummaryDays(
  workspaceId: string,
  from: string,
  to: string,
): Promise<string[]> {
  const rows = await db
    .select({ day: daySummaries.day })
    .from(daySummaries)
    .where(
      and(
        eq(daySummaries.workspaceId, workspaceId),
        gte(daySummaries.day, from),
        lte(daySummaries.day, to),
      ),
    )
    .orderBy(asc(daySummaries.day));
  return rows.map((r) => r.day);
}

export { DAY_SUMMARY_MODEL };
