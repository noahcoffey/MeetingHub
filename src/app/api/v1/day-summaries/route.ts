import { NextResponse } from "next/server";
import { generateDaySummary, listDaySummaries } from "@/lib/day-summaries";
import { isValidDateParam } from "@/lib/dates";
import {
  checkFeature,
  err,
  readJsonBody,
  resolveWorkspace,
  withV1,
} from "../_lib/helpers";

export const dynamic = "force-dynamic";

// Generation is a model call over a full day of notes — well past the default
// serverless budget.
export const maxDuration = 300;

// List is meta-only (no markdown bodies) — fetch a summary by id for the body.
// Optional ?from=&to= (YYYY-MM-DD, inclusive) narrow the range; no pagination.
export const GET = withV1({}, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "meetings");
  if (disabled) return disabled;

  const params = new URL(req.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (from !== null && !isValidDateParam(from)) {
    return err("from must be YYYY-MM-DD", 400);
  }
  if (to !== null && !isValidDateParam(to)) {
    return err("to must be YYYY-MM-DD", 400);
  }

  const items = await listDaySummaries(ws.workspace.id, {
    from: from ?? undefined,
    to: to ?? undefined,
  });
  return NextResponse.json({ items });
});

// Generate for a given date. Idempotent per (workspace, day): re-running
// replaces the generated body of the one row for that day rather than creating
// a second summary — and never touches a hand-edited body (see
// generateDaySummary). Any past day is allowed; looking back is the point.
export const POST = withV1({ write: true }, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "meetings");
  if (disabled) return disabled;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const { date } = (parsed.body ?? {}) as { date?: unknown };
  if (typeof date !== "string" || !isValidDateParam(date)) {
    return err("date is required (YYYY-MM-DD)", 400);
  }

  const result = await generateDaySummary(ws.workspace.id, date);
  if (!result.ok) {
    const status =
      result.reason === "no-notes"
        ? 400
        : result.reason === "in-flight"
          ? 409
          : result.reason === "not-configured"
            ? 503
            : 502;
    return err(result.message, status);
  }
  // 201 on the first summary for a day, 200 on a regenerate — the same
  // created/overwritten distinction PUT /api/v1/summaries makes.
  return NextResponse.json(
    { item: result.item },
    { status: result.created ? 201 : 200 },
  );
});
