import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createMeetingFromPending,
  discardPendingIngest,
  matchPendingToMeeting,
} from "@/lib/ingest";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Resolve a pending ingest: { action: "match", meetingId } or { action: "create" }.
export const POST = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { action, meetingId } = (body ?? {}) as {
    action?: unknown;
    meetingId?: unknown;
  };

  if (action === "match") {
    if (typeof meetingId !== "string" || !meetingId) {
      return NextResponse.json({ error: "meetingId required" }, { status: 400 });
    }
    const ok = await matchPendingToMeeting(id, meetingId);
    if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, meetingId });
  }

  if (action === "create") {
    const workspaceId = await getActiveWorkspaceId();
    const meetingId = await createMeetingFromPending(workspaceId, id);
    if (!meetingId) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, meetingId });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
});

// Discard a pending ingest without acting on it.
export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await discardPendingIngest(id);
  return NextResponse.json({ ok: true });
});
