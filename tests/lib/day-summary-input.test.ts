import { describe, expect, it } from "vitest";
import {
  computeDayStats,
  computeInputFingerprint,
  extractGeneratedSections,
  formatMinutes,
  notedMeetings,
  UNSECTIONED_FALLBACK_CHARS,
  type DaySummaryMeetingInput,
} from "@/lib/day-summary-input";
import { buildDaySummaryPrompt } from "@/lib/day-summary-prompt";

function meeting(
  over: Partial<DaySummaryMeetingInput> = {},
): DaySummaryMeetingInput {
  return {
    id: "m1",
    title: "Standup",
    startTime: new Date("2026-09-14T13:00:00Z"),
    endTime: new Date("2026-09-14T13:30:00Z"),
    notes: "typed notes",
    notesUpdatedAt: new Date("2026-09-14T14:00:00Z"),
    notesGenerated: null,
    notesGeneratedUpdatedAt: null,
    attendees: [],
    ...over,
  };
}

describe("notedMeetings", () => {
  it("keeps meetings with manual notes, generated notes, or both", () => {
    const rows = [
      meeting({ id: "a", notes: "hi", notesGenerated: null }),
      meeting({ id: "b", notes: "", notesGenerated: "## Summary\nx" }),
      meeting({ id: "c", notes: " ", notesGenerated: "   " }),
      meeting({ id: "d", notes: "", notesGenerated: null }),
    ];
    expect(notedMeetings(rows).map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("computeInputFingerprint", () => {
  it("is stable regardless of row order", () => {
    const a = meeting({ id: "a" });
    const b = meeting({ id: "b", notesUpdatedAt: new Date("2026-09-14T19:31:00Z") });
    expect(computeInputFingerprint([a, b])).toBe(computeInputFingerprint([b, a]));
  });

  it("changes when manual notes are edited after generation", () => {
    const before = computeInputFingerprint([meeting()]);
    const after = computeInputFingerprint([
      meeting({ notesUpdatedAt: new Date("2026-09-14T19:31:00Z") }),
    ]);
    expect(after).not.toBe(before);
  });

  it("changes when generated notes land later in the day", () => {
    const before = computeInputFingerprint([meeting()]);
    const after = computeInputFingerprint([
      meeting({
        notesGenerated: "## Summary\nx",
        notesGeneratedUpdatedAt: new Date("2026-09-14T20:04:00Z"),
      }),
    ]);
    expect(after).not.toBe(before);
  });

  it("ignores meetings with no notes — an ICS import must not mark a summary stale", () => {
    const withNotes = [meeting({ id: "a" })];
    const plusEmptyImport = [
      ...withNotes,
      meeting({ id: "z", notes: "", notesGenerated: null }),
    ];
    expect(computeInputFingerprint(plusEmptyImport)).toBe(
      computeInputFingerprint(withNotes),
    );
  });
});

describe("extractGeneratedSections", () => {
  const body = [
    "## Summary",
    "We agreed to build on the existing platform.",
    "",
    "## Key Discussion Points",
    "Fifteen paragraphs of transcript restatement.",
    "",
    "### Decisions Made",
    "- Scope the quoting tool down",
    "",
    "## Open Questions",
    "More restatement.",
    "",
    "## Action Items:",
    "- [ ] Confirm approval landed",
    "",
    "## Notes",
    "Even more restatement.",
  ].join("\n");

  it("keeps only Summary, Decisions Made and Action Items", () => {
    const out = extractGeneratedSections(body);
    expect(out).toContain("existing platform");
    expect(out).toContain("Scope the quoting tool down");
    expect(out).toContain("Confirm approval landed");
    expect(out).not.toContain("transcript restatement");
    expect(out).not.toContain("More restatement");
    expect(out).not.toContain("Even more restatement");
  });

  it("normalizes heading level, case and trailing punctuation", () => {
    const out = extractGeneratedSections(
      "###### summary:\nbody text\n# ACTION ITEMS\n- thing",
    );
    expect(out).toContain("## Summary");
    expect(out).toContain("## Action Items");
    expect(out).toContain("body text");
  });

  it("returns empty for empty input", () => {
    expect(extractGeneratedSections(null)).toBe("");
    expect(extractGeneratedSections("   ")).toBe("");
  });

  it("falls back to a capped excerpt, never the full body, when no heading matches", () => {
    const long = "x".repeat(UNSECTIONED_FALLBACK_CHARS * 3);
    const out = extractGeneratedSections(`## Transcript\n${long}`);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("truncated");
  });
});

describe("computeDayStats", () => {
  it("sums scheduled durations over noted meetings only", () => {
    const stats = computeDayStats([
      meeting({
        id: "a",
        startTime: new Date("2026-09-14T13:00:00Z"),
        endTime: new Date("2026-09-14T14:00:00Z"),
      }),
      meeting({
        id: "b",
        startTime: new Date("2026-09-14T15:00:00Z"),
        endTime: new Date("2026-09-14T17:45:00Z"),
      }),
      // No notes — counts for nothing.
      meeting({
        id: "c",
        notes: "",
        notesGenerated: null,
        startTime: new Date("2026-09-14T18:00:00Z"),
        endTime: new Date("2026-09-14T19:00:00Z"),
      }),
    ]);
    expect(stats.meetingCount).toBe(2);
    expect(stats.totalMinutes).toBe(225);
    expect(stats.totalTimeLabel).toBe("3h 45m");
  });

  it("counts overlap twice — this is sum-of-durations, not wall clock", () => {
    const stats = computeDayStats([
      meeting({
        id: "a",
        startTime: new Date("2026-09-14T13:00:00Z"),
        endTime: new Date("2026-09-14T14:00:00Z"),
      }),
      meeting({
        id: "b",
        startTime: new Date("2026-09-14T13:50:00Z"),
        endTime: new Date("2026-09-14T14:50:00Z"),
      }),
    ]);
    // Wall clock would be 110 minutes; the documented figure is 120.
    expect(stats.totalMinutes).toBe(120);
  });

  it("counts a meeting with no end time but adds no time for it", () => {
    const stats = computeDayStats([meeting({ endTime: null })]);
    expect(stats.meetingCount).toBe(1);
    expect(stats.totalTimeLabel).toBe("");
  });
});

describe("formatMinutes", () => {
  it.each([
    [0, ""],
    [45, "45m"],
    [120, "2h"],
    [225, "3h 45m"],
  ])("%i -> %s", (mins, label) => {
    expect(formatMinutes(mins)).toBe(label);
  });
});

describe("buildDaySummaryPrompt", () => {
  const rows = [
    meeting({
      id: "a",
      title: "1:1",
      notes: "Atlas is the platform of record.",
      notesGenerated:
        "## Summary\nAtlus was discussed.\n\n## Key Discussion Points\nnoise noise noise",
      attendees: [{ name: "Alex Rivera", email: "alex@example.com" }],
    }),
    meeting({
      id: "b",
      title: "Working session",
      notes: "",
      notesGenerated: "## Decisions Made\n- Build iteratively",
      attendees: [],
    }),
  ];

  it("includes manual notes in full and only the wanted generated sections", () => {
    const p = buildDaySummaryPrompt("Monday, September 14, 2026", rows);
    expect(p).toContain("Atlas is the platform of record.");
    expect(p).toContain("Build iteratively");
    expect(p).not.toContain("noise noise noise");
  });

  it("passes the computed header figures as data", () => {
    const p = buildDaySummaryPrompt("Monday, September 14, 2026", rows);
    expect(p).toContain("Meeting count: 2");
    expect(p).toContain("Total time (sum of scheduled durations): 1h");
  });

  it("names attendees when the calendar captured them, and says so when it didn't", () => {
    const p = buildDaySummaryPrompt("Monday, September 14, 2026", rows);
    expect(p).toContain("Alex Rivera");
    expect(p).toContain("Attendees: not recorded");
  });

  it("marks a meeting with no manual notes rather than implying there were some", () => {
    const p = buildDaySummaryPrompt("Monday, September 14, 2026", rows);
    expect(p).toContain("nothing was typed by hand");
  });

  it("omits meetings with no notes at all", () => {
    const p = buildDaySummaryPrompt("Monday, September 14, 2026", [
      ...rows,
      meeting({ id: "z", title: "Blocked focus time", notes: "", notesGenerated: null }),
    ]);
    expect(p).not.toContain("Blocked focus time");
    expect(p).toContain("Meeting count: 2");
  });
});
