import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  reassociateIngestEvent,
  reassociateIngestEventToNew,
} from "@/lib/ingest";
import { getActiveWorkspaceId } from "@/lib/workspace-context";
import { getWorkspaceById } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Re-associate a logged ingest push (Settings → Ingest log):
// { action: "match", meetingId } or { action: "create", workspaceId? }.
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
  const { action, meetingId, workspaceId } = (body ?? {}) as {
    action?: unknown;
    meetingId?: unknown;
    workspaceId?: unknown;
  };

  let result;
  if (action === "match") {
    if (typeof meetingId !== "string" || !meetingId) {
      return NextResponse.json({ error: "meetingId required" }, { status: 400 });
    }
    result = await reassociateIngestEvent(id, meetingId);
  } else if (action === "create") {
    // An unknown workspace id falls back to the push's hint / active workspace
    // rather than erroring, like /api/meetings?workspace= does.
    const chosen =
      typeof workspaceId === "string" && workspaceId
        ? ((await getWorkspaceById(workspaceId))?.id ?? null)
        : null;
    result = await reassociateIngestEventToNew(
      id,
      await getActiveWorkspaceId(),
      chosen,
    );
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  if (result.ok) return NextResponse.json({ ok: true, meetingId: result.meetingId });
  const status =
    result.reason === "not-found"
      ? 404
      : result.reason === "target-occupied"
        ? 409
        : 400;
  return NextResponse.json({ error: result.reason }, { status });
});
