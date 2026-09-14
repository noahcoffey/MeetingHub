// Date helpers, local copies — this sub-package deliberately can't import
// from ../../src (it runs standalone, outside the Next build).
//
// Note the division of labour: this file only picks WHICH day to ask for.
// Which meetings fall on that day is the server's business
// (src/lib/day-summary-context.ts uses the same query the day view does), so
// the runner never needs to know APP_TIMEZONE.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDate(value: string | undefined): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

// YYYY-MM-DD for "now" in the machine's local timezone. The runner lives on
// the user's laptop, so local time is the right clock for "what was yesterday".
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

// The day this run summarizes: yesterday. Scheduled for the small hours, so
// the day being written up has genuinely ended and late-arriving notes (the
// recorder often posts hours after a meeting) are already in. A catch-up run
// after a closed lid still resolves to the same day as long as it happens
// before the next midnight; further back, pass --date.
export function targetDay(): string {
  return shiftDate(todayLocal(), -1);
}

// `--date 2026-09-14` overrides the target day; anything else is an error
// rather than a silent fallback to yesterday.
export function parseArgs(argv: string[]): { date?: string } {
  const i = argv.indexOf("--date");
  if (i === -1) return {};
  const value = argv[i + 1];
  if (!isValidDate(value)) {
    throw new Error("--date requires a YYYY-MM-DD value");
  }
  return { date: value };
}
