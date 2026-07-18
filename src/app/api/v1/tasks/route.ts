import { NextResponse } from "next/server";
import {
  createActionItem,
  listDoneActionItems,
  listOpenActionItems,
  listScheduledActionItems,
  MilestoneAssignmentError,
} from "@/lib/action-items";
import { isRecurrenceUnit } from "@/lib/recurrence";
import {
  checkRefsInWorkspace,
  err,
  readJsonBody,
  resolveWorkspace,
  withV1,
} from "../_lib/helpers";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withV1({}, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;

  const status = new URL(req.url).searchParams.get("status") ?? "open";
  if (status === "open") {
    return NextResponse.json({ items: await listOpenActionItems(ws.workspace.id) });
  }
  if (status === "done") {
    return NextResponse.json({ items: await listDoneActionItems(ws.workspace.id) });
  }
  if (status === "scheduled") {
    return NextResponse.json({
      items: await listScheduledActionItems(ws.workspace.id),
    });
  }
  return err("status must be open, done, or scheduled", 400);
});

export const POST = withV1({ write: true }, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;

  const {
    content,
    ownerName,
    dueDate,
    projectId,
    milestoneId,
    priority,
    recurrenceUnit,
    recurrenceInterval,
  } = (parsed.body ?? {}) as {
    content?: unknown;
    ownerName?: unknown;
    dueDate?: unknown;
    projectId?: unknown;
    milestoneId?: unknown;
    priority?: unknown;
    recurrenceUnit?: unknown;
    recurrenceInterval?: unknown;
  };

  if (typeof content !== "string" || content.trim() === "") {
    return err("content is required", 400);
  }
  if (dueDate !== undefined && dueDate !== null) {
    if (typeof dueDate !== "string" || !DATE_RE.test(dueDate)) {
      return err("dueDate must be YYYY-MM-DD", 400);
    }
  }

  const refs = {
    projectId: typeof projectId === "string" ? projectId : null,
    milestoneId: typeof milestoneId === "string" ? milestoneId : null,
  };
  const refErr = await checkRefsInWorkspace(ws.workspace.id, refs);
  if (refErr) return refErr;

  let item;
  try {
    item = await createActionItem(ws.workspace.id, {
      content: content.trim(),
      ownerName:
        typeof ownerName === "string" && ownerName.trim()
          ? ownerName.trim()
          : null,
      dueDate: typeof dueDate === "string" ? dueDate : null,
      projectId: refs.projectId,
      milestoneId: refs.milestoneId,
      priority:
        typeof priority === "number" && [1, 2, 3].includes(priority)
          ? priority
          : null,
      recurrenceUnit: isRecurrenceUnit(recurrenceUnit) ? recurrenceUnit : null,
      recurrenceInterval:
        typeof recurrenceInterval === "number" &&
        Number.isInteger(recurrenceInterval) &&
        recurrenceInterval >= 1 &&
        recurrenceInterval <= 365
          ? recurrenceInterval
          : null,
    });
  } catch (e) {
    if (e instanceof MilestoneAssignmentError) return err(e.message, 400);
    throw e;
  }
  return NextResponse.json({ item }, { status: 201 });
});
