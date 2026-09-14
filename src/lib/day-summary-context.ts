import "server-only";
import { getMeetingsForDate } from "./meetings";
import { formatDateLabel, formatTimeInTz } from "./dates";
import {
  computeDayStats,
  computeInputFingerprint,
  extractGeneratedSections,
  notedMeetings,
} from "./day-summary-input";

// The payload the local Day-Summary runner reads to write one day's summary
// (mirrors lib/summary-context.ts for the weekly runner). Everything the model
// needs is prepared HERE so the runner stays a thin model-call-and-push client:
//
//   - The day's meetings come from getMeetingsForDate — the same query the day
//     view lists — so the runner never buckets a day itself and can never
//     disagree with what the view shows.
//   - Times are pre-rendered in APP_TIMEZONE. The runner runs on a laptop in
//     an unrelated timezone and must not hold a second copy of that setting.
//   - Generated notes are cut to Summary / Decisions Made / Action Items before
//     they cross the wire, so a day of full transcript reconstructions (~15k
//     words) never leaves the server.
//   - inputFingerprint is included so the runner can echo it back on push. It
//     must describe the inputs as they were READ, not as they are when the
//     push lands minutes later — see upsertDaySummary.

export type DaySummaryContextMeeting = {
  title: string;
  /** "9:00 AM – 10:00 AM" in APP_TIMEZONE, already formatted. */
  timeLabel: string;
  startTime: string;
  endTime: string | null;
  /** Names/emails from the calendar invite; empty when none were captured. */
  attendees: string[];
  /** Manual notes, in full. Empty string when nothing was typed by hand. */
  notes: string;
  /** Only the wanted sections of the AI-generated notes; "" when there are none. */
  generatedSections: string;
};

export type DaySummaryContext = {
  date: string;
  /** "Monday, September 14, 2026" — use verbatim in the header line. */
  dateLabel: string;
  /** False when no meeting that day has notes: skip, don't call the model. */
  hasNotes: boolean;
  meetingCount: number;
  /** Sum of scheduled durations, not wall clock. See computeDayStats. */
  totalTimeLabel: string;
  inputFingerprint: string;
  meetings: DaySummaryContextMeeting[];
};

export async function getDaySummaryContext(
  workspaceId: string,
  date: string,
): Promise<DaySummaryContext> {
  const all = await getMeetingsForDate(workspaceId, date);
  const noted = notedMeetings(all);
  const stats = computeDayStats(all);

  return {
    date,
    dateLabel: formatDateLabel(date),
    hasNotes: noted.length > 0,
    meetingCount: stats.meetingCount,
    totalTimeLabel: stats.totalTimeLabel,
    inputFingerprint: computeInputFingerprint(all),
    meetings: noted.map((m) => ({
      title: m.title,
      timeLabel: m.endTime
        ? `${formatTimeInTz(m.startTime)} – ${formatTimeInTz(m.endTime)}`
        : formatTimeInTz(m.startTime),
      startTime: m.startTime.toISOString(),
      endTime: m.endTime?.toISOString() ?? null,
      attendees: m.attendees
        .map((a) => a.name ?? a.email)
        .filter((x): x is string => !!x && x.trim() !== ""),
      notes: m.notes.trim(),
      generatedSections: extractGeneratedSections(m.notesGenerated),
    })),
  };
}
