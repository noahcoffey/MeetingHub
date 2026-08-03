import { NextResponse } from "next/server";
import { buildSummaryContext } from "@/lib/summary-context";
import { isValidDateParam, shiftDate, startOfWeek, todayInAppTz } from "@/lib/dates";
import { err, resolveWorkspace, withV1 } from "../_lib/helpers";

export const dynamic = "force-dynamic";

// Purpose-built aggregate for the Sunday-Summary runner: everything the
// weekly-prep prompt needs in one payload. No route-level checkFeature — the
// aggregate spans features, and the assembler nulls out disabled sections.
export const GET = withV1({}, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;

  const param = new URL(req.url).searchParams.get("weekStart");
  // Default: the Monday of "tomorrow"'s week — a Sunday run targets the week
  // ahead, and a Monday catch-up run targets that same week.
  const weekStart = param ?? startOfWeek(shiftDate(todayInAppTz(), 1));
  if (!isValidDateParam(weekStart) || startOfWeek(weekStart) !== weekStart) {
    return err("weekStart must be a Monday (YYYY-MM-DD)", 400);
  }

  const item = await buildSummaryContext(ws.workspace, weekStart);
  return NextResponse.json({ item });
});
