import { NextResponse } from "next/server";
import { createMeeting, getMeetingsInRange } from "@/lib/meetings";
import { todayInAppTz } from "@/lib/dates";
import {
  checkFeature,
  err,
  readJsonBody,
  resolveWorkspace,
  withV1,
} from "../_lib/helpers";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function shiftDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// List items are summaries (hasNotes/hasGenerated flags, no bodies) — fetch a
// meeting by id for the full row.
export const GET = withV1({}, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "meetings");
  if (disabled) return disabled;

  const params = new URL(req.url).searchParams;
  const to = params.get("to") ?? todayInAppTz();
  const from = params.get("from") ?? shiftDays(to, -30);
  if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
    return err("from/to must be YYYY-MM-DD", 400);
  }
  if (from > to) return err("from must not be after to", 400);

  const items = await getMeetingsInRange(ws.workspace.id, from, to);
  return NextResponse.json({ items });
});

export const POST = withV1({ write: true }, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "meetings");
  if (disabled) return disabled;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const { title, startTime, endTime } = (parsed.body ?? {}) as {
    title?: unknown;
    startTime?: unknown;
    endTime?: unknown;
  };

  if (typeof title !== "string" || title.trim() === "") {
    return err("title is required", 400);
  }
  const start =
    typeof startTime === "string" ? new Date(startTime) : new Date(NaN);
  if (Number.isNaN(start.getTime())) {
    return err("startTime must be an ISO datetime", 400);
  }
  let end: Date | null = null;
  if (endTime !== undefined && endTime !== null) {
    end = typeof endTime === "string" ? new Date(endTime) : new Date(NaN);
    if (Number.isNaN(end.getTime())) {
      return err("endTime must be an ISO datetime", 400);
    }
  }

  const item = await createMeeting(ws.workspace.id, {
    title: title.trim(),
    startTime: start,
    endTime: end,
  });
  return NextResponse.json({ item }, { status: 201 });
});
