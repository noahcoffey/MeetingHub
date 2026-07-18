import { NextResponse } from "next/server";
import {
  getMeeting,
  saveMeetingNotes,
  updateMeetingMeta,
} from "@/lib/meetings";
import {
  checkFeature,
  checkRefsInWorkspace,
  checkRowWorkspace,
  err,
  readJsonBody,
  withV1,
} from "../../_lib/helpers";

export const dynamic = "force-dynamic";

export const GET = withV1({}, async (_req, ctx, principal) => {
  const { id } = await ctx.params;
  const item = await getMeeting(id);
  if (!item) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, item.workspaceId);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "meetings");
  if (disabled) return disabled;
  return NextResponse.json({ item });
});

export const PATCH = withV1({ write: true }, async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const existing = await getMeeting(id);
  if (!existing) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, existing.workspaceId);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "meetings");
  if (disabled) return disabled;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const { title, startTime, endTime, projectId, notes } = (parsed.body ??
    {}) as {
    title?: unknown;
    startTime?: unknown;
    endTime?: unknown;
    projectId?: unknown;
    notes?: unknown;
  };

  const meta: {
    title?: string;
    startTime?: Date;
    endTime?: Date | null;
    projectId?: string | null;
  } = {};
  if (typeof title === "string" && title.trim() !== "") {
    meta.title = title.trim();
  }
  if (typeof startTime === "string") {
    const d = new Date(startTime);
    if (Number.isNaN(d.getTime())) {
      return err("startTime must be an ISO datetime", 400);
    }
    meta.startTime = d;
  }
  if (endTime === null) meta.endTime = null;
  else if (typeof endTime === "string") {
    const d = new Date(endTime);
    if (Number.isNaN(d.getTime())) {
      return err("endTime must be an ISO datetime", 400);
    }
    meta.endTime = d;
  }
  if (projectId === null) meta.projectId = null;
  else if (typeof projectId === "string") {
    const refErr = await checkRefsInWorkspace(existing.workspaceId, {
      projectId,
    });
    if (refErr) return refErr;
    meta.projectId = projectId;
  }

  const wantsNotes = typeof notes === "string";
  if (Object.keys(meta).length === 0 && !wantsNotes) {
    return err("nothing to update", 400);
  }

  if (Object.keys(meta).length > 0) {
    await updateMeetingMeta(id, meta);
  }
  // Null base skips the optimistic-concurrency check — API writes are
  // documented last-write-wins.
  if (wantsNotes) await saveMeetingNotes(id, notes as string, null);

  return NextResponse.json({ item: await getMeeting(id) });
});
