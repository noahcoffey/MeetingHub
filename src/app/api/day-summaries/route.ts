import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  generateDaySummary,
  getDaySummaryForDay,
  liveStatus,
} from "@/lib/day-summaries";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { isFeatureEnabled } from "@/lib/workspaces";
import { isValidDateParam } from "@/lib/dates";

export const dynamic = "force-dynamic";

// A full-day synthesis can run for minutes; the browser fetch is what shows
// progress, and the row's `generating` status covers a reload mid-flight.
export const maxDuration = 300;

// Session-authed twin of POST /api/v1/day-summaries, for the "Generate day
// summary" button on the day view. Workspace comes from the active-workspace
// cookie (UI state), exactly as /api/calendar/import does; the v1 route takes
// it from the bearer token instead. Both funnel into the same lib function.
export const POST = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const workspace = await getActiveWorkspace();
  if (!isFeatureEnabled(workspace, "meetings")) {
    return NextResponse.json(
      { error: "Meetings are disabled in this workspace." },
      { status: 403 },
    );
  }
  const date = new URL(req.url).searchParams.get("date");
  if (!isValidDateParam(date)) {
    return NextResponse.json(
      { error: "date is required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }

  const result = await generateDaySummary(workspace.id, date);
  if (!result.ok) {
    const status =
      result.reason === "no-notes"
        ? 400
        : result.reason === "in-flight"
          ? 409
          : result.reason === "not-configured"
            ? 503
            : 502;
    return NextResponse.json({ error: result.message }, { status });
  }
  return NextResponse.json(
    { ok: true, id: result.item.id },
    { status: result.created ? 201 : 200 },
  );
});

// Poll target for a reload that landed mid-generation: returns just the live
// status for a day, never a body.
export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const workspace = await getActiveWorkspace();
  const date = new URL(req.url).searchParams.get("date");
  if (!isValidDateParam(date)) {
    return NextResponse.json(
      { error: "date is required (YYYY-MM-DD)" },
      { status: 400 },
    );
  }
  const row = await getDaySummaryForDay(workspace.id, date);
  // liveStatus, not the raw column: a row abandoned by a crashed server would
  // otherwise keep the card polling "Generating…" forever.
  return NextResponse.json({ status: liveStatus(row) });
});
