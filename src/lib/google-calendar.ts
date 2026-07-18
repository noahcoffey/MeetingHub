import "server-only";
import type { Attendee, Workspace } from "@/db/schema";
import { startOfDayUtc, shiftDate } from "./dates";
import { upsertCalendarMeetings, type CalendarUpsert } from "./meetings";
import { IMPORT_RANGE_DAYS } from "./ics-calendar";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const CAL_API = "https://www.googleapis.com/calendar/v3";
// openid+email identifies the account; calendar.readonly is the only data scope.
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.readonly",
].join(" ");

const FETCH_TIMEOUT_MS = 15_000;

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super("Google OAuth is not configured");
    this.name = "GoogleNotConfiguredError";
  }
}

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

function clientCreds(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new GoogleNotConfiguredError();
  return { id, secret };
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// The redirect URI must exactly match one registered in the Google Cloud console.
export function redirectUri(origin: string): string {
  return (
    process.env.GOOGLE_REDIRECT_URI ||
    `${origin}/api/calendar/google/callback`
  );
}

// Build the consent URL. access_type=offline + prompt=consent forces a refresh
// token even on re-consent.
export function authUrl(origin: string, state: string): string {
  const { id } = clientCreds();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Exchange an authorization code for tokens. Returns the refresh token + scope.
export async function exchangeCode(
  code: string,
  origin: string,
): Promise<{ refreshToken: string; accessToken: string; scope: string }> {
  const { id, secret } = clientCreds();
  const res = await timedFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error("google code exchange failed");
  const json = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
  };
  if (!json.refresh_token || !json.access_token) {
    // No refresh token means the account was already consented without offline
    // access — the caller should tell the user to remove app access & retry.
    throw new Error("google did not return a refresh token");
  }
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    scope: json.scope ?? GOOGLE_SCOPES,
  };
}

export async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await timedFetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("google userinfo failed");
  const json = (await res.json()) as { email?: string };
  if (!json.email) throw new Error("google account has no email");
  return json.email.toLowerCase();
}

async function accessTokenFromRefresh(refreshToken: string): Promise<string> {
  const { id, secret } = clientCreds();
  const res = await timedFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error("google token refresh failed");
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("google token refresh returned no token");
  return json.access_token;
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
