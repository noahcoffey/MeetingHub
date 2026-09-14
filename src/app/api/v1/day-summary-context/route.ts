import { NextResponse } from "next/server";
import { getDaySummaryContext } from "@/lib/day-summary-context";
import { isValidDateParam } from "@/lib/dates";
import { checkFeature, err, resolveWorkspace, withV1 } from "../_lib/helpers";

export const dynamic = "force-dynamic";

// Everything the local Day-Summary runner needs to write one day's summary,
// assembled in one payload (the daily counterpart to /api/v1/summary-context).
//
// A day with no noted meetings is a 200 with `hasNotes: false`, NOT an error:
// the runner fires nightly, most weekends have nothing, and a 4xx would turn
// every quiet day into a failed job.
export const GET = withV1({}, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "meetings");
  if (disabled) return disabled;

  const date = new URL(req.url).searchParams.get("date");
  if (!isValidDateParam(date)) return err("date is required (YYYY-MM-DD)", 400);

  const item = await getDaySummaryContext(ws.workspace.id, date);
  return NextResponse.json({ item });
});
