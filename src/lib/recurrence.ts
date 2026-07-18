// Recurrence rules for action items. A rule is (unit, interval): "every
// `interval` `unit`s"; "weekday" means the next Mon–Fri day and ignores the
// interval. Pure calendar math on YYYY-MM-DD strings (tz-agnostic, like
// shiftDate in dates.ts) so it's safe to import from client components.

export const RECURRENCE_UNITS = [
  "day",
  "weekday",
  "week",
  "month",
  "year",
] as const;
export type RecurrenceUnit = (typeof RECURRENCE_UNITS)[number];

export function isRecurrenceUnit(v: unknown): v is RecurrenceUnit {
  return RECURRENCE_UNITS.includes(v as RecurrenceUnit);
}

function toYmd(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return toYmd(new Date(Date.UTC(y, m - 1, d + days)));
}

// Calendar-month add, clamped to the target month's last day (Jan 31 +1mo → Feb 28).
function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ty = Math.floor(total / 12);
  const tm = total % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return toYmd(new Date(Date.UTC(ty, tm, Math.min(d, lastDay))));
}

function advance(date: string, unit: RecurrenceUnit, interval: number): string {
  switch (unit) {
    case "day":
      return addDays(date, interval);
    case "weekday": {
      const [y, m, d] = date.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d + 1));
      while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) {
        dt.setUTCDate(dt.getUTCDate() + 1);
      }
      return toYmd(dt);
    }
    case "week":
      return addDays(date, 7 * interval);
    case "month":
      return addMonths(date, interval);
    case "year":
      return addMonths(date, 12 * interval);
  }
}

// Due date for the occurrence spawned when a recurring item is completed on
// `today`. Advances from the old due date so weekly/monthly rhythms keep their
// anchor day, but never lands on or before today — an item overdue by several
// periods skips ahead to the first occurrence after today instead of spawning
// already-overdue copies.
export function nextOccurrence(
  dueDate: string | null,
  unit: RecurrenceUnit,
  interval: number | null,
  today: string,
): string {
  const step = Math.max(1, Math.floor(interval ?? 1));
  let next = advance(dueDate ?? today, unit, step);
  while (next <= today) next = advance(next, unit, step);
  return next;
}

// "Daily" / "Every weekday" / "Every 2 weeks" — popover options and titles.
export function recurrenceLabel(unit: RecurrenceUnit, interval: number | null): string {
  const n = Math.max(1, interval ?? 1);
  if (unit === "weekday") return "Every weekday";
  if (n === 1) {
    return { day: "Daily", week: "Weekly", month: "Monthly", year: "Yearly" }[unit];
  }
  return `Every ${n} ${unit}s`;
}
