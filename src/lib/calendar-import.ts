import "server-only";
import type { Workspace } from "@/db/schema";
import {
  CalendarNotConfiguredError,
  IMPORT_RANGE_DAYS,
  importEventsForRange,
} from "./ics-calendar";
import {
  GoogleNotConfiguredError,
  googleConfigured,
  importGoogleEventsForRange,
} from "./google-calendar";
import { getRefreshToken } from "./google-accounts";

export { CalendarNotConfiguredError, IMPORT_RANGE_DAYS };

// A workspace's calendar source: a chosen Google calendar takes precedence over
// an ICS URL; otherwise it's manual-only. Resolves + delegates to the right
// importer, both of which share the idempotent meetings upsert.
export async function importWorkspaceRange(
  workspace: Workspace,
  startDateStr: string,
  days: number = IMPORT_RANGE_DAYS,
): Promise<number> {
  if (workspace.googleAccountId && workspace.googleCalendarId) {
    if (!googleConfigured()) throw new GoogleNotConfiguredError();
    const refreshToken = await getRefreshToken(workspace.googleAccountId);
    if (!refreshToken) throw new CalendarNotConfiguredError();
    return importGoogleEventsForRange(
      workspace,
      refreshToken,
      workspace.googleCalendarId,
      startDateStr,
      days,
    );
  }
  // Falls back to ICS (throws CalendarNotConfiguredError if no feed either).
  return importEventsForRange(workspace, startDateStr, days);
}

export type CalendarSourceKind = "google" | "ics" | "none";

export function calendarSourceKind(workspace: Workspace): CalendarSourceKind {
  if (workspace.googleAccountId && workspace.googleCalendarId) return "google";
  if (workspace.icsUrl) return "ics";
  return "none";
}
