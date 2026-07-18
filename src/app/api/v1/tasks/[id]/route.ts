import { NextResponse } from "next/server";
import {
  getActionItem,
  MilestoneAssignmentError,
  updateActionItem,
} from "@/lib/action-items";
import { isRecurrenceUnit, type RecurrenceUnit } from "@/lib/recurrence";
import {
  checkRefsInWorkspace,
  checkRowWorkspace,
  err,
  readJsonBody,
  withV1,
} from "../../_lib/helpers";

export const dynamic = "force-dynamic";

const STATUSES = ["open", "done"] as const;
type Status = (typeof STATUSES)[number];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withV1({}, async (_req, ctx, principal) => {
  const { id } = await ctx.params;
  const item = await getActionItem(id);
  if (!item) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, item.workspaceId);
  if (!ws.ok) return ws.res;
  return NextResponse.json({ item });
});

export const PATCH = withV1({ write: true }, async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const existing = await getActionItem(id);
  if (!existing) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, existing.workspaceId);
  if (!ws.ok) return ws.res;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;

  const {
    content,
    ownerName,
    status,
    dueDate,
    projectId,
    milestoneId,
    priority,
    recurrenceUnit,
    recurrenceInterval,
    snoozedUntil,
  } = (parsed.body ?? {}) as {
    content?: unknown;
    ownerName?: unknown;
    status?: unknown;
    dueDate?: unknown;
    projectId?: unknown;
    milestoneId?: unknown;
    priority?: unknown;
    recurrenceUnit?: unknown;
    recurrenceInterval?: unknown;
    snoozedUntil?: unknown;
  };

  const patch: {
    content?: string;
    ownerName?: string | null;
    status?: Status;
    dueDate?: string | null;
    projectId?: string | null;
    milestoneId?: string | null;
    priority?: number | null;
    recurrenceUnit?: RecurrenceUnit | null;
    recurrenceInterval?: number | null;
    snoozedUntil?: string | null;
  } = {};

  if (typeof content === "string" && content.trim() !== "") {
    patch.content = content.trim();
  }
  if (ownerName === null) patch.ownerName = null;
  else if (typeof ownerName === "string") patch.ownerName = ownerName.trim() || null;
  if (STATUSES.includes(status as Status)) patch.status = status as Status;
  if (dueDate === null) patch.dueDate = null;
  else if (typeof dueDate === "string" && DATE_RE.test(dueDate)) {
    patch.dueDate = dueDate;
  }
  if (projectId === null) patch.projectId = null;
  else if (typeof projectId === "string") patch.projectId = projectId;
  if (milestoneId === null) patch.milestoneId = null;
  else if (typeof milestoneId === "string") patch.milestoneId = milestoneId;
  if (priority === null) patch.priority = null;
  else if (typeof priority === "number" && [1, 2, 3].includes(priority)) {
    patch.priority = priority;
  }
  if (recurrenceUnit === null) patch.recurrenceUnit = null;
  else if (isRecurrenceUnit(recurrenceUnit)) {
    patch.recurrenceUnit = recurrenceUnit;
    patch.recurrenceInterval =
      typeof recurrenceInterval === "number" &&
      Number.isInteger(recurrenceInterval) &&
      recurrenceInterval >= 1 &&
      recurrenceInterval <= 365
        ? recurrenceInterval
        : 1;
  }
  if (snoozedUntil === null) patch.snoozedUntil = null;
  else if (typeof snoozedUntil === "string" && DATE_RE.test(snoozedUntil)) {
    patch.snoozedUntil = snoozedUntil;
  }

  if (Object.keys(patch).length === 0) return err("nothing to update", 400);

  const refErr = await checkRefsInWorkspace(existing.workspaceId, {
    projectId: patch.projectId,
    milestoneId: patch.milestoneId,
  });
  if (refErr) return refErr;

  let item, next;
  try {
    ({ item, next } = await updateActionItem(id, patch));
  } catch (e) {
    if (e instanceof MilestoneAssignmentError) return err(e.message, 400);
    throw e;
  }
  if (!item) return err("not found", 404);
  // `next` is the occurrence spawned by completing a recurring item, if any.
  return NextResponse.json({ item, next: next ?? null });
});
