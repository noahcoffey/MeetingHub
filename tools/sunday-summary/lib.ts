// Date helpers, local copies — this sub-package deliberately can't import
// from ../../src (it runs standalone, outside the Next build).

// YYYY-MM-DD for "now" in the machine's local timezone. The runner lives on
// the user's laptop, so local time is the right clock for "is it Sunday".
export function todayLocal(): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Add/subtract whole days from a YYYY-MM-DD string (calendar math).
export function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

// Monday of the calendar week containing dateStr.
export function startOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun .. 6=Sat
  const sinceMonday = (dow + 6) % 7;
  return shiftDate(dateStr, -sinceMonday);
}

// The week this run prepares for: Monday of "tomorrow"'s week. A Sunday run
// targets the week ahead; a Monday catch-up run (launchd firing after wake)
// targets that same week — reruns are idempotent via the server-side upsert.
export function targetWeekStart(): string {
  return startOfWeek(shiftDate(todayLocal(), 1));
}
