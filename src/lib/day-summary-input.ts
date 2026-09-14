// Pure input-shaping for the Day Summary: what gets sent to the model, and the
// fingerprint that decides when a stored summary has gone stale. No db, no
// network, no React — unit-tested in tests/lib/day-summary-input.test.ts.
import { createHash } from "node:crypto";

// The per-meeting shape this module needs. A superset of it (a full `Meeting`
// row) satisfies it, so callers pass rows straight through.
export type DaySummaryMeetingInput = {
  id: string;
  title: string;
  startTime: Date;
  endTime: Date | null;
  notes: string;
  notesUpdatedAt: Date;
  notesGenerated: string | null;
  notesGeneratedUpdatedAt: Date | null;
  attendees: { email?: string; name?: string; responseStatus?: string }[];
};

export function hasAnyNotes(m: {
  notes: string;
  notesGenerated: string | null;
}): boolean {
  return (
    m.notes.trim().length > 0 || (m.notesGenerated ?? "").trim().length > 0
  );
}

// The meetings that actually feed the model: the day's meetings (as the day
// view buckets them) that carry manual or generated notes. Everything else in
// this module operates on this filtered set — including the fingerprint, so an
// ICS import that adds a note-less meeting doesn't mark the summary stale.
export function notedMeetings<T extends { notes: string; notesGenerated: string | null }>(
  meetings: T[],
): T[] {
  return meetings.filter(hasAnyNotes);
}

// Stable over the day's noted meetings and the two timestamps that track their
// note content. Recomputed on every day-view load and compared with the stored
// value; a mismatch means notes landed or changed after generation.
//
// Deliberately NOT over `meetings.updated_at`: upsertCalendarMeetings bumps
// that on every ICS re-import while leaving notes untouched, which would mark
// every summary stale within 15 minutes.
export function computeInputFingerprint(
  meetings: DaySummaryMeetingInput[],
): string {
  const parts = notedMeetings(meetings)
    .map(
      (m) =>
        `${m.id}:${m.notesUpdatedAt.toISOString()}:${
          m.notesGeneratedUpdatedAt?.toISOString() ?? "-"
        }`,
    )
    // Sorted so row order out of the database can never change the hash.
    .sort();
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

// ---- generated-notes section extraction ----

// Only the Summary / Decisions Made / Action Items sections of `notesGenerated`
// reach the model. The rest of a generated body (Key Discussion Points, Open
// Questions, Notes) restates what those three already carry: on the day this
// was designed, six meetings' full generated notes ran to ~15,000 words, and
// passing all of it made the model slower, dearer, and more likely to produce a
// list instead of a synthesis. Do not "fix" this by passing the full body.
const WANTED_SECTIONS = [
  { key: "Summary", match: /^(summary|overview|tl;?dr)$/ },
  { key: "Decisions Made", match: /^decisions?(\s+made)?$/ },
  { key: "Action Items", match: /^(action\s+items?|actions?|next\s+steps)$/ },
] as const;

const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;

function normalizeHeading(text: string): string {
  return text
    .replace(/[*_`]/g, "")
    .replace(/[:.]+$/, "")
    .trim()
    .toLowerCase();
}

// Cap on the fallback path below, so an unheaded transcript dump can't smuggle
// a full body past the whole point of this function.
export const UNSECTIONED_FALLBACK_CHARS = 1500;

/**
 * Pull the wanted sections out of a generated-notes body.
 *
 * Tolerant by design — the bodies come from whatever external recorder pushed
 * them via /api/ingest, so heading level (`##` vs `###`), case, trailing
 * colons and bold markers all vary. When no wanted heading matches at all, the
 * fallback is the first {@link UNSECTIONED_FALLBACK_CHARS} characters, never
 * the full body.
 */
export function extractGeneratedSections(body: string | null): string {
  if (!body || body.trim() === "") return "";
  const lines = body.split(/\r?\n/);

  const picked: string[] = [];
  let capturing: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    if (capturing) {
      const content = buffer.join("\n").trim();
      if (content) picked.push(`## ${capturing}\n\n${content}`);
    }
    capturing = null;
    buffer = [];
  };

  for (const line of lines) {
    const heading = HEADING_RE.exec(line);
    if (heading) {
      flush();
      const norm = normalizeHeading(heading[2]);
      const wanted = WANTED_SECTIONS.find((s) => s.match.test(norm));
      if (wanted) capturing = wanted.key;
      continue;
    }
    if (capturing) buffer.push(line);
  }
  flush();

  if (picked.length > 0) return picked.join("\n\n");

  const trimmed = body.trim();
  return trimmed.length <= UNSECTIONED_FALLBACK_CHARS
    ? trimmed
    : `${trimmed.slice(0, UNSECTIONED_FALLBACK_CHARS).trimEnd()}\n\n…(truncated — no Summary/Decisions/Action Items headings found)`;
}

// ---- header stats ----

export type DayStats = {
  meetingCount: number;
  /** Minutes, summed per meeting. See {@link computeDayStats} for which figure this is. */
  totalMinutes: number;
  /** "3h 45m" / "45m" / "" when nothing is timed. */
  totalTimeLabel: string;
};

/**
 * Meeting count and total time for the summary's header line.
 *
 * Computed here and passed to the model as data — asking it to sum six time
 * ranges gets the arithmetic wrong.
 *
 * **Which figure this is:** the *sum of scheduled durations*, not wall-clock
 * time in meetings. On a day where two meetings overlap by ten minutes, this
 * reports 3h 45m where wall-clock would report 3h 35m. Sum-of-durations is what
 * "I spent this long in meetings" means to a reader, and it doesn't quietly
 * shrink when the calendar double-books. Meetings with no `endTime` contribute
 * to the count but not the time.
 */
export function computeDayStats(meetings: DaySummaryMeetingInput[]): DayStats {
  const noted = notedMeetings(meetings);
  let totalMinutes = 0;
  for (const m of noted) {
    if (!m.endTime) continue;
    const ms = m.endTime.getTime() - m.startTime.getTime();
    if (ms > 0) totalMinutes += Math.round(ms / 60000);
  }
  return {
    meetingCount: noted.length,
    totalMinutes,
    totalTimeLabel: formatMinutes(totalMinutes),
  };
}

export function formatMinutes(total: number): string {
  if (total <= 0) return "";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}
