import { describe, expect, it } from "vitest";
import {
  endOfDayUtc,
  formatDateInTz,
  isValidDateParam,
  isWeekendDateStr,
  shiftDate,
  shiftMonth,
  startOfDayUtc,
  startOfWeek,
} from "@/lib/dates";

describe("isValidDateParam", () => {
  it("accepts YYYY-MM-DD and rejects everything else", () => {
    expect(isValidDateParam("2026-07-10")).toBe(true);
    expect(isValidDateParam("2026-7-1")).toBe(false);
    expect(isValidDateParam("not-a-date")).toBe(false);
    expect(isValidDateParam(undefined)).toBe(false);
    expect(isValidDateParam(null)).toBe(false);
  });
});

describe("isWeekendDateStr", () => {
  it("detects Saturday and Sunday", () => {
    expect(isWeekendDateStr("2026-07-11")).toBe(true); // Sat
    expect(isWeekendDateStr("2026-07-12")).toBe(true); // Sun
    expect(isWeekendDateStr("2026-07-10")).toBe(false); // Fri
    expect(isWeekendDateStr("2026-07-13")).toBe(false); // Mon
  });
});

describe("startOfWeek", () => {
  it("returns the Monday of the containing week", () => {
    expect(startOfWeek("2026-08-03")).toBe("2026-08-03"); // Mon → itself
    expect(startOfWeek("2026-08-05")).toBe("2026-08-03"); // Wed
    expect(startOfWeek("2026-08-09")).toBe("2026-08-03"); // Sun → previous Mon
  });
  it("crosses month and year boundaries", () => {
    expect(startOfWeek("2026-08-01")).toBe("2026-07-27"); // Sat, week starts in July
    expect(startOfWeek("2027-01-01")).toBe("2026-12-28"); // Fri, week starts in prior year
  });
});

describe("shiftDate", () => {
  it("adds and subtracts days", () => {
    expect(shiftDate("2026-07-10", 1)).toBe("2026-07-11");
    expect(shiftDate("2026-07-10", -1)).toBe("2026-07-09");
  });
  it("crosses month and year boundaries", () => {
    expect(shiftDate("2026-07-31", 1)).toBe("2026-08-01");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("handles a leap day", () => {
    expect(shiftDate("2024-02-28", 1)).toBe("2024-02-29");
  });
});

describe("shiftMonth", () => {
  it("always lands on the 1st so short months can't drift", () => {
    expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftMonth("2026-03-15", -1)).toBe("2026-02-01");
    expect(shiftMonth("2026-12-10", 1)).toBe("2027-01-01");
  });
});

describe("startOfDayUtc / endOfDayUtc", () => {
  it("round-trips to the same calendar day in the app tz", () => {
    const tz = "America/New_York";
    const start = startOfDayUtc("2026-07-10", tz);
    expect(formatDateInTz(start, tz)).toBe("2026-07-10");
  });
  it("end of day equals the start of the next day", () => {
    const tz = "America/New_York";
    expect(endOfDayUtc("2026-07-10", tz).getTime()).toBe(
      startOfDayUtc("2026-07-11", tz).getTime(),
    );
  });
});
