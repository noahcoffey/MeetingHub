import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  importWorkspaceRange,
  IMPORT_RANGE_DAYS,
  CalendarNotConfiguredError,
} from "@/lib/calendar-import";
import { GoogleNotConfiguredError } from "@/lib/google-calendar";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { isFeatureEnabled } from "@/lib/workspaces";
import { isValidDateParam, todayInAppTz } from "@/lib/dates";

export const dynamic = "force-dynamic";

export const POST = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const workspace = await getActiveWorkspace();
  if (!isFeatureEnabled(workspace, "calendar")) {
    return NextResponse.json(
      { error: "Calendar import is disabled in this workspace." },
      { status: 403 },
    );
  }
  const param = new URL(req.url).searchParams.get("date");
  const date = isValidDateParam(param) ? param : todayInAppTz();

  try {
    // Import the viewed day plus the next week so a single click covers upcoming
    // meetings. Source (Google calendar or ICS feed) is resolved per workspace.
    const count = await importWorkspaceRange(workspace, date);
    return NextResponse.json({
      ok: true,
      date,
      days: IMPORT_RANGE_DAYS,
      imported: count,
    });
  } catch (err) {
    if (
      err instanceof CalendarNotConfiguredError ||
      err instanceof GoogleNotConfiguredError
    ) {
      return NextResponse.json(
        { error: "Calendar source is not configured." },
        { status: 503 },
      );
    }
    // Don't leak token/calendar details into the response or logs.
    console.error("[calendar] import failed");
    return NextResponse.json(
      { error: "Calendar import failed." },
      { status: 502 },
    );
  }
});
