import { describe, expect, it } from "vitest";
import {
  isRecurrenceUnit,
  nextOccurrence,
  recurrenceLabel,
} from "@/lib/recurrence";
import { isWeekendDateStr } from "@/lib/dates";

describe("nextOccurrence", () => {
  it("advances a daily rule from the due date", () => {
    expect(nextOccurrence("2026-07-10", "day", 1, "2026-07-10")).toBe(
      "2026-07-11",
    );
  });

  it("honours a multi-unit interval", () => {
    expect(nextOccurrence("2026-07-10", "week", 2, "2026-07-10")).toBe(
      "2026-07-24",
    );
    expect(nextOccurrence("2026-07-10", "day", 3, "2026-07-10")).toBe(
      "2026-07-13",
    );
  });

  it("keeps the weekly anchor day", () => {
    // 2026-07-10 + 1 week = 2026-07-17 (same weekday).
    expect(nextOccurrence("2026-07-10", "week", 1, "2026-07-10")).toBe(
      "2026-07-17",
    );
  });

  it("skips ahead past today for an overdue rule (no already-overdue copies)", () => {
    // Due long ago, completed today → first daily occurrence strictly after today.
    expect(nextOccurrence("2026-07-01", "day", 1, "2026-07-10")).toBe(
      "2026-07-11",
    );
    // Weekly overdue by several periods → still lands after today, on the anchor weekday.
    const next = nextOccurrence("2026-06-05", "week", 1, "2026-07-10");
    expect(next > "2026-07-10").toBe(true);
  });

  it("weekday rule always lands on a Mon–Fri after the date", () => {
    const next = nextOccurrence("2026-07-10", "weekday", 1, "2026-07-10");
    expect(next > "2026-07-10").toBe(true);
    expect(isWeekendDateStr(next)).toBe(false);
  });

  it("clamps a monthly rule to the target month's last day", () => {
    // Jan 31 + 1 month → Feb 28 (2026 is not a leap year).
    expect(nextOccurrence("2026-01-31", "month", 1, "2026-01-31")).toBe(
      "2026-02-28",
    );
  });

  it("clamps a yearly rule across a leap day", () => {
    // Feb 29 2024 + 1 year → Feb 28 2025.
    expect(nextOccurrence("2024-02-29", "year", 1, "2024-02-29")).toBe(
      "2025-02-28",
    );
  });

  it("advances from today when there is no due date", () => {
    expect(nextOccurrence(null, "day", 1, "2026-07-10")).toBe("2026-07-11");
  });

  it("treats a null/zero interval as 1", () => {
    expect(nextOccurrence("2026-07-10", "day", null, "2026-07-10")).toBe(
      "2026-07-11",
    );
    expect(nextOccurrence("2026-07-10", "day", 0, "2026-07-10")).toBe(
      "2026-07-11",
    );
  });
});

describe("recurrenceLabel", () => {
  it("labels single-interval rules", () => {
    expect(recurrenceLabel("day", 1)).toBe("Daily");
    expect(recurrenceLabel("week", 1)).toBe("Weekly");
    expect(recurrenceLabel("month", 1)).toBe("Monthly");
    expect(recurrenceLabel("year", 1)).toBe("Yearly");
  });
  it("labels weekday regardless of interval", () => {
    expect(recurrenceLabel("weekday", 5)).toBe("Every weekday");
  });
  it("labels multi-interval rules", () => {
    expect(recurrenceLabel("day", 3)).toBe("Every 3 days");
    expect(recurrenceLabel("week", 2)).toBe("Every 2 weeks");
  });
});

describe("isRecurrenceUnit", () => {
  it("accepts valid units and rejects others", () => {
    expect(isRecurrenceUnit("day")).toBe(true);
    expect(isRecurrenceUnit("weekday")).toBe(true);
    expect(isRecurrenceUnit("fortnight")).toBe(false);
    expect(isRecurrenceUnit(null)).toBe(false);
  });
});
