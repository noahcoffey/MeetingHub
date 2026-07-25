import "server-only";
import type { Attendee, Workspace } from "@/db/schema";
import { startOfDayUtc, shiftDate } from "./dates";
import { upsertCalendarMeetings, type CalendarUpsert } from "./meetings";
import { IMPORT_RANGE_DAYS } from "./ics-calendar";

import {
  accessTokenFromRefresh,
  buildAuthUrl,
  exchangeCode as exchangeCodeForUri,
  timedFetch,
} from "./google-auth";

// Shared OAuth plumbing lives in google-auth.ts; this module keeps the
// calendar-flavored surface its routes were built against.
export {
  googleConfigured,
  fetchUserEmail,
  GoogleNotConfiguredError,
} from "./google-auth";

const CAL_API = "https://www.googleapis.com/calendar/v3";
// openid+email identifies the account; calendar.readonly is the only data scope.
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

// The redirect URI must exactly match one registered in the Google Cloud console.
export function redirectUri(origin: string): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    `${origin}/api/calendar/google/callback`
  );
}

export function authUrl(origin: string, state: string): string {
  return buildAuthUrl({
    scope: GOOGLE_SCOPES,
    redirectUri: redirectUri(origin),
    state,
  });
}

// Exchange an authorization code for tokens. Returns the refresh token + scope.
export async function exchangeCode(
  code: string,
  origin: string,
): Promise<{ refreshToken: string; accessToken: string; scope: string }> {
  const out = await exchangeCodeForUri(code, redirectUri(origin));
  return { ...out, scope: out.scope || GOOGLE_SCOPES };
}

export type GoogleCalendarSummary = {
  id: string;
  summary: string;
  primary: boolean;
};

// The calendars this account can read (for the per-workspace picker).
export async function listCalendars(
  refreshToken: string,
): Promise<GoogleCalendarSummary[]> {
  const token = await accessTokenFromRefresh(refreshToken);
  const res = await timedFetch(
    `${CAL_API}/users/me/calendarList?minAccessRole=reader&maxResults=250`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error("google calendarList failed");
  const json = (await res.json()) as {
    items?: { id: string; summary?: string; primary?: boolean }[];
  };
  return (json.items ?? []).map((c) => ({
    id: c.id,
    summary: c.summary ?? c.id,
    primary: Boolean(c.primary),
  }));
}

// ---- event mapping (pure — unit-testable without the network) ----

type GoogleDateTime = { dateTime?: string; date?: string };
export type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  start?: GoogleDateTime;
  end?: GoogleDateTime;
  attendees?: {
    email?: string;
    displayName?: string;
    responseStatus?: string;
  }[];
};

// All-day events carry `date` (no time) — treat as UTC midnight, matching how the
// reports layer already skips midnight-anchored all-day blocks.
function parseWhen(w: GoogleDateTime | undefined): Date | null {
  if (!w) return null;
  if (w.dateTime) return new Date(w.dateTime);
  if (w.date) return new Date(`${w.date}T00:00:00Z`);
  return null;
}

function mapAttendees(atts: GoogleEvent["attendees"]): Attendee[] {
  return (atts ?? [])
    .map((a) => ({
      email: a.email?.trim() || undefined,
      name: a.displayName?.trim() || undefined,
      responseStatus: a.responseStatus || undefined,
    }))
    .filter((a) => a.email || a.name);
}

// Map Google events (already expanded via singleEvents=true) to the shared
// upsert shape. Keyed on Google's per-instance event id so re-imports are
// idempotent and generated-notes ingest can still match on calendar_event_id.
export function mapGoogleEvents(events: GoogleEvent[]): CalendarUpsert[] {
  const byId = new Map<string, CalendarUpsert>();
  for (const e of events) {
    if (e.status === "cancelled" || !e.id) continue;
    const start = parseWhen(e.start);
    if (!start) continue;
    byId.set(e.id, {
      calendarEventId: e.id,
      title: (e.summary || "(no title)").trim(),
      description: e.description?.trim() || null,
      startTime: start,
      endTime: parseWhen(e.end),
      attendees: mapAttendees(e.attendees),
    });
  }
  return [...byId.values()];
}

async function fetchEvents(
  accessToken: string,
  calendarId: string,
  timeMin: string,
  timeMax: string,
): Promise<GoogleEvent[]> {
  const out: GoogleEvent[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "2500",
    });
    if (pageToken) params.set("pageToken", pageToken);
    const res = await timedFetch(
      `${CAL_API}/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) throw new Error("google events.list failed");
    const json = (await res.json()) as {
      items?: GoogleEvent[];
      nextPageToken?: string;
    };
    out.push(...(json.items ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

// Import `days` calendar days from a workspace's chosen Google calendar,
// reusing the idempotent meetings upsert.
export async function importGoogleEventsForRange(
  workspace: Workspace,
  refreshToken: string,
  calendarId: string,
  startDateStr: string,
  days: number = IMPORT_RANGE_DAYS,
): Promise<number> {
  const token = await accessTokenFromRefresh(refreshToken);
  const timeMin = startOfDayUtc(startDateStr).toISOString();
  const timeMax = startOfDayUtc(shiftDate(startDateStr, days)).toISOString();
  const events = await fetchEvents(token, calendarId, timeMin, timeMax);
  return upsertCalendarMeetings(workspace.id, mapGoogleEvents(events));
}
