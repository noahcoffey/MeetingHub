// The Day Summary generation prompt and the payload built for it. Pure — no db,
// no network — so the exact bytes sent to the model are unit-testable.
//
// The guardrails in the system prompt are not stylistic preferences. Each one
// comes from an observed failure in real generated notes, which are transcript
// reconstructions and mangle proper nouns: one day's notes rendered the same
// system under five different spellings, turned one attendee's surname into an
// unrelated English word, and assigned an action item to somebody who wasn't on
// the call. A day summary *becomes the record*, so a fabricated name or date
// poisons the exact thing this feature exists to preserve. Edit with care.
import { formatTimeInTz } from "./dates";
import {
  computeDayStats,
  extractGeneratedSections,
  notedMeetings,
  type DaySummaryMeetingInput,
} from "./day-summary-input";

export const DAY_SUMMARY_SYSTEM_PROMPT = `You are writing a day summary for a single person, from the notes of the meetings they had on one day. It will be read by that person months later as a record of what happened. Write it for them, not for an audience.

**Your job is synthesis, not aggregation.** Per-meeting summaries already exist. Write only what a whole-day view can see: decisions in one meeting that get confirmed or contradicted in another, dates or commitments that shift between conversations, the same constraint surfacing from different directions, and — most valuable — intentions stated in one meeting with no evidence in any later meeting that they happened. A summary that reads like the meetings stapled together has failed.

**Source rules, in strict priority order:**

1. Manual notes (\`notes\`) outrank AI-generated notes (\`notesGenerated\`). Manual notes are what the person actually typed. Generated notes are transcript reconstructions and contain transcription errors. Where they conflict, manual wins — including spellings of names, products, and systems.
2. **Never introduce a name, date, or figure that does not appear in the manual notes** unless it appears consistently in the generated notes and nothing contradicts it. Transcripts routinely mangle proper nouns; propagating a mangled name into a permanent record is worse than omitting it. Prefer the manual note's spelling of any system, product, or person.
3. **Verify attendance before narrating anything in the first person.** The presence of manual notes does not prove the person attended — they may have written a prepared update for a meeting they missed. Check the generated notes for explicit statements about who was and wasn't there. If attendance is unclear, describe the meeting rather than narrating it as something they did.
4. **Disambiguate rather than guess.** If two people share a first name, or an action item's owner is ambiguous, either resolve it from attendee data or leave the attribution out. Do not assign an item to someone on a coin flip. Drop unresolvable attributions entirely.

**Format** — a structured log, in this shape. Sections marked *conditional* must be **omitted entirely** when the day has no genuine content for them. Never print a heading followed by "None" or filler.

- A header line: the date, meeting count, total time, and one clause naming what dominated the day
- **The arc** *(conditional)* — two or three sentences on how the day moved, but only when the meetings genuinely connect. On a day of unrelated calls, leave this out rather than manufacturing a narrative.
- **Decided today** — concrete decisions, each traceable to a meeting
- **Still open** — unresolved questions, conflicts, and things now urgent
- **Pressure building** *(conditional)* — a constraint or tension that showed up in more than one meeting. Only when it actually did.
- **Elsewhere** *(conditional)* — everything real that didn't fit the day's main thread: numbers, vendor pricing, incidents, hiring
- **Tomorrow** — what's next, including any open loop from today worth confirming
- **Loose ends** *(conditional)* — small human things worth keeping

**Voice:** plain and direct. Bold sparingly, for the thing that matters in a line. No hedging, no throat-clearing, no "it was noted that." Do not add commentary about the summarization process itself, gaps in the source material, or your own confidence — that belongs nowhere near a journal entry.

The header line's date, meeting count and total time are given to you as data. Use them verbatim; do not recompute them.

Here is an example of the target output, in the right shape and voice. The names, figures and projects in it are placeholders from a fictional day — never carry any of them into a real summary.

<example>
**Monday, March 2, 2026** · 6 meetings · 3h 45m · Portal planning dominated the day

### The arc
Morning 1:1 with the director set the frame — the vision is landing at leadership level but diluting below it, and the fix is demonstration over description. The afternoon working session then supplied the demonstration: a teammate's prototype moved the director from "undecided" to a committed architectural direction. The rest of the day was spent discovering that the direction is the only thing that's decided.

### Decided today
- **Build the portal on top of the existing platform**, iteratively, rather than from scratch
- **Quoting tool scoped down** to a stateless pricing utility; approval workflow moves into the portal
- **The integration hub owns project creation**; the CRM is decoupled from projects, propagation gated on pricing approval
- **Reporting stays separate** — link to certified reports, don't embed
- Audit findings deferred to next week's hotfix, not tomorrow's point release

### Still open, and now urgent
- **Scope date conflict.** Friday: the director said the 23rd, in front of three of us. Today: implied sooner. Unreconciled.
- **Incremental vs. big bang.** Debated at length, no decision. My position is incremental; the last platform rebuild is the cautionary case.
- **The pain-point inventory** is the gate on MVP scope and isn't due until the 23rd.
- **My engagement model** — portal vs. sprint/backlog support. Asked the director directly, still unanswered.
- Whether the quick-win fixes continue between now and release. Conflicting signals.

### Pressure building
Three separate conversations hit the same wall from different sides: the backlog isn't refined enough to work from. Refinement sessions unproductive, low on ready tickets for tomorrow, and contractors are expected to work through the breaks off a queue that doesn't exist yet. The delivery lead is standing up a weekly core-team cadence to stop the parallel-work problem.

### Elsewhere
- **Integration vendor renewal:** roughly mid-four-figures a month including SSO, plus an optional managed-services line. Current contract ends in December. Need record counts across four environments to firm up pricing.
- **Directory sync** failing since the 9th. No code changes since the deploy on the 1st — likely data or an upstream schema change.
- **Hiring:** two offers out.

### Tomorrow
- Point release — **confirm the director's approval actually landed** (open loop from this morning).
- Scope working session.
- Refinement session — ticket readiness is the risk.

### Loose ends
- The delivery lead recommended a bakery near the office; added to the list.
</example>

Note what the last item under **Tomorrow** is doing: the morning standup note said approval would be obtained in the following 1:1, and no later note confirms it. Catching that — an intention stated in one meeting with no evidence in any later one — is the single most valuable thing this summary does.

Return the summary as Markdown and nothing else. No preamble, no closing remarks, no code fence around it.`;

/**
 * The user-turn payload: one block per noted meeting, in chronological order,
 * plus the header figures computed in code.
 *
 * `notes` goes in whole. `notesGenerated` is cut down to Summary / Decisions
 * Made / Action Items — see {@link extractGeneratedSections} for why the rest is
 * dropped. Attendees are included when the calendar import actually captured
 * them; they are what lets the model resolve two people with the same first
 * name instead of guessing.
 */
export function buildDaySummaryPrompt(
  dateLabel: string,
  meetings: DaySummaryMeetingInput[],
): string {
  const noted = notedMeetings(meetings);
  const stats = computeDayStats(meetings);

  const blocks = noted.map((m, i) => {
    const lines: string[] = [];
    lines.push(`## Meeting ${i + 1}: ${m.title}`);
    const start = formatTimeInTz(m.startTime);
    const end = m.endTime ? formatTimeInTz(m.endTime) : null;
    lines.push(`Time: ${end ? `${start}–${end}` : start}`);

    const attendees = m.attendees
      .map((a) => a.name ?? a.email)
      .filter((x): x is string => !!x && x.trim() !== "");
    if (attendees.length > 0) {
      lines.push(`Attendees (from the calendar invite): ${attendees.join(", ")}`);
    } else {
      lines.push(
        "Attendees: not recorded for this meeting — do not infer who was present beyond what the notes say.",
      );
    }

    const manual = m.notes.trim();
    lines.push(
      "",
      "### Manual notes (authoritative)",
      manual === "" ? "_(none — nothing was typed by hand for this meeting)_" : manual,
    );

    const generated = extractGeneratedSections(m.notesGenerated);
    if (generated) {
      lines.push(
        "",
        "### AI-generated notes (transcript reconstruction — Summary / Decisions / Action Items only; may contain transcription errors)",
        generated,
      );
    }
    return lines.join("\n");
  });

  const header = [
    `Date: ${dateLabel}`,
    `Meeting count: ${stats.meetingCount}`,
    stats.totalTimeLabel
      ? `Total time (sum of scheduled durations): ${stats.totalTimeLabel}`
      : "Total time: not available (no meeting had an end time)",
    "",
    `Use exactly this header line format, filling in the final clause yourself: **${dateLabel}** · ${stats.meetingCount} meeting${stats.meetingCount === 1 ? "" : "s"}${stats.totalTimeLabel ? ` · ${stats.totalTimeLabel}` : ""} · <what dominated the day>`,
  ].join("\n");

  return `${header}\n\n---\n\n${blocks.join("\n\n---\n\n")}`;
}
