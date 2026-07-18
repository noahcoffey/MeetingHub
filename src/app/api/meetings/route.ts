import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createMeeting, getMeetingsForDate } from "@/lib/meetings";
import { getActiveWorkspaceId } from "@/lib/workspace-context";
import { getWorkspaceById } from "@/lib/workspaces";
import { isValidDateParam, todayInAppTz } from "@/lib/dates";

export const dynamic = "force-dynamic";

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  // Optional override so the Incoming review can list meetings from a pending
  // push's tagged workspace, not the one currently active. Invalid ids fall
  // back to the active workspace rather than erroring.
  const requested = params.get("workspace");
  const workspaceId =
    (requested && (await getWorkspaceById(requested))?.id) ||
    (await getActiveWorkspaceId());
  const param = params.get("date");
  const date = isValidDateParam(param) ? param : todayInAppTz();
  const list = await getMeetingsForDate(workspaceId, date);
  return NextResponse.json({ date, meetings: list });
});

export const POST = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { title, startTime, endTime } = (body ?? {}) as {
    title?: unknown;
    startTime?: unknown;
    endTime?: unknown;
  };

  if (typeof title !== "string" || title.trim() === "") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const start = typeof startTime === "string" ? new Date(startTime) : new Date();
  if (Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "invalid startTime" }, { status: 400 });
  }

  let end: Date | null = null;
  if (typeof endTime === "string" && endTime) {
    const e = new Date(endTime);
    if (!Number.isNaN(e.getTime())) end = e;
  }

  const workspaceId = await getActiveWorkspaceId();
  const meeting = await createMeeting(workspaceId, {
    title: title.trim(),
    startTime: start,
    endTime: end,
  });
  return NextResponse.json({ meeting }, { status: 201 });
});
