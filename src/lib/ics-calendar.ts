import "server-only";
import IcalExpander from "ical-expander";
import type { Attendee, Workspace } from "@/db/schema";
import { startOfDayUtc, endOfDayUtc, shiftDate } from "./dates";
import { upsertCalendarMeetings, type CalendarUpsert } from "./meetings";
import { safeFetchText } from "./net-guard";

// Number of calendar days a range import covers (the viewed day + next 7).
export const IMPORT_RANGE_DAYS = 8;

export class CalendarNotConfiguredError extends Error {
  constructor() {
    super("Calendar ICS feed is not configured");
    this.name = "CalendarNotConfiguredError";
  }
}

const FETCH_TIMEOUT_MS = 15_000;

// The ICS feed is a workspace setting (Settings -> Workspaces). The legacy
// CALENDAR_ICS_URL env var is adopted into the default workspace's ics_url by
// the migration runner, so there is no env fallback at read time.

// SSRF-safe fetch: scheme + resolved-IP validation on every redirect hop, a
// timeout, and a body-size cap (see lib/net-guard). The URL is user-set, so it
// must not be able to reach internal/link-local hosts (cloud metadata, etc.).
async function fetchIcs(url: string): Promise<string> {
  return safeFetchText(url, {
    timeoutMs: FETCH_TIMEOUT_MS,
    maxBytes: 5 * 1024 * 1024,
    headers: { Accept: "text/calendar, text/plain" },
  });
}

function mapAttendees(props: { getFirstValue(): unknown; getParameter(name: string): string | null }[]): Attendee[] {
  return (props ?? [])
    .map((p) => {
      const raw = p.getFirstValue();
      const value = typeof raw === "string" ? raw : String(raw ?? "");
      const email = value.replace(/^mailto:/i, "").trim() || undefined;
      return {
        email,
        name: p.getParameter("cn") ?? undefined,
        responseStatus: p.getParameter("partstat") ?? undefined,
      };
    })
    .filter((a) => a.email || a.name);
}

// Fetch + parse the workspace's ICS feed and upsert events in [after, before) into
// `meetings`. Idempotent on (workspace_id, calendar_event_id) (recurring instances
// get a per-occurrence id).
async function importBetween(
  workspace: Workspace,
  after: Date,
  before: Date,
): Promise<number> {
  const url = workspace.icsUrl;
  if (!url) throw new CalendarNotConfiguredError();

  const ics = await fetchIcs(url);
  const expander = new IcalExpander({ ics, maxIterations: 5000 });
  const { events, occurrences } = expander.between(after, before);

  // Dedupe by calendar_event_id — a single ON CONFLICT batch can't touch the same row twice.
  const byId = new Map<string, CalendarUpsert>();

  for (const e of events) {
    if (!e.uid) continue;
    byId.set(e.uid, {
      calendarEventId: e.uid,
      title: (e.summary || "(no title)").trim(),
      description: e.description?.trim() || null,
      startTime: e.startDate.toJSDate(),
      endTime: e.endDate ? e.endDate.toJSDate() : null,
      attendees: mapAttendees(e.attendees),
    });
  }

  for (const o of occurrences) {
    const item = o.item;
    if (!item?.uid) continue;
    const start = o.startDate.toJSDate();
    // Each occurrence of a recurring series is its own meeting, keyed by instance start.
    const id = `${item.uid}_${start.toISOString()}`;
    byId.set(id, {
      calendarEventId: id,
      title: (item.summary || "(no title)").trim(),
      description: item.description?.trim() || null,
      startTime: start,
      endTime: o.endDate ? o.endDate.toJSDate() : null,
      attendees: mapAttendees(item.attendees),
    });
  }

  return upsertCalendarMeetings(workspace.id, [...byId.values()]);
}

// Import a single calendar day.
export function importEventsForDate(
  workspace: Workspace,
  dateStr: string,
): Promise<number> {
  return importBetween(workspace, startOfDayUtc(dateStr), endOfDayUtc(dateStr));
}

// Import `days` calendar days starting at `startDateStr` (inclusive).
export function importEventsForRange(
  workspace: Workspace,
  startDateStr: string,
  days: number = IMPORT_RANGE_DAYS,
): Promise<number> {
  return importBetween(
    workspace,
    startOfDayUtc(startDateStr),
    startOfDayUtc(shiftDate(startDateStr, days)),
  );
}
