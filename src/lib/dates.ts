// Day-boundary math is done in a single app timezone so "today" is stable
// regardless of where the server runs (Docker = UTC). Single-user tool, so one
// configured timezone is correct. Override with APP_TIMEZONE.
export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? "America/New_York";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateParam(value: string | undefined | null): value is string {
  return typeof value === "string" && DATE_RE.test(value);
}

// YYYY-MM-DD for "now" in the app timezone.
export function todayInAppTz(): string {
  return formatDateInTz(new Date(), APP_TIMEZONE);
}

// Current hour (0–23) in the app timezone.
export function hourInAppTz(): number {
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TIMEZONE,
      hourCycle: "h23",
      hour: "2-digit",
    }).format(new Date()),
  );
}

export function formatDateInTz(date: Date, timeZone: string): string {
  // en-CA gives YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Saturday/Sunday check for a YYYY-MM-DD string (calendar math, tz-agnostic).
export function isWeekendDateStr(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

// Add/subtract whole days from a YYYY-MM-DD string (calendar math, tz-agnostic).
export function shiftDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

// First day of the month `deltaMonths` away from dateStr's month. Always lands
// on the 1st so month stepping can't drift on short months.
export function shiftMonth(dateStr: string, deltaMonths: number): string {
  const [y, m] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + deltaMonths, 1));
  return dt.toISOString().slice(0, 10);
}

// "July 2026" for any date within the month.
export function formatMonthLabel(dateStr: string): string {
  const [y, m] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, 1, 12)));
}

// Human label for a meeting time, rendered in the app timezone.
export function formatTimeInTz(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

// Offset (ms) of `timeZone` at the given instant: wallclock-as-UTC minus the instant.
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(
    dtf.formatToParts(date).map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(
    Number(p.year),
    Number(p.month) - 1,
    Number(p.day),
    Number(p.hour),
    Number(p.minute),
    Number(p.second),
  );
  return asUtc - date.getTime();
}

// The UTC instant for local midnight (start of `dateStr`) in the app timezone.
export function startOfDayUtc(dateStr: string, timeZone = APP_TIMEZONE): Date {
  const guess = new Date(`${dateStr}T00:00:00Z`);
  const offset = tzOffsetMs(guess, timeZone);
  return new Date(guess.getTime() - offset);
}

export function endOfDayUtc(dateStr: string, timeZone = APP_TIMEZONE): Date {
  return startOfDayUtc(shiftDate(dateStr, 1), timeZone);
}

function ordinalSuffix(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  switch (n % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
}

// "Tuesday, June 29th" in the app timezone.
export function formatPrettyDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = Number(get("day"));
  return `${get("weekday")}, ${get("month")} ${day}${ordinalSuffix(day)}`;
}

// "Sunday, June 28th" from a YYYY-MM-DD string (UTC-noon anchored, no year).
export function formatPrettyDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).formatToParts(dt);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = Number(get("day"));
  return `${get("weekday")}, ${get("month")} ${day}${ordinalSuffix(day)}`;
}

export function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(dt);
}
