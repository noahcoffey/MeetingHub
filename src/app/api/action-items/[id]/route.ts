import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteActionItem,
  MilestoneAssignmentError,
  updateActionItem,
} from "@/lib/action-items";
import { isRecurrenceUnit, type RecurrenceUnit } from "@/lib/recurrence";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const STATUSES = ["open", "done"] as const;
type Status = (typeof STATUSES)[number];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const PATCH = auth(async (req, ctx) => {
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
    waitingOnPersonId,
    untaggedDismissed,
  } = (body ?? {}) as {
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
    waitingOnPersonId?: unknown;
    untaggedDismissed?: unknown;
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
    waitingOnPersonId?: string | null;
    untaggedDismissedAt?: Date;
  } = {};
  // "Doesn't need a project" — hides the task from the Projects triage inbox.
  if (untaggedDismissed === true) patch.untaggedDismissedAt = new Date();

  if (typeof content === "string" && content.trim() !== "") {
    patch.content = content.trim();
  }
  // Waiting-on: ownerName is the free-text who, waitingOnPersonId the linked
  // one; the lib derives owner from them.
  if (ownerName === null) patch.ownerName = null;
  else if (typeof ownerName === "string") {
    patch.ownerName = ownerName.trim() || null;
  }
  if (waitingOnPersonId === null) patch.waitingOnPersonId = null;
  else if (typeof waitingOnPersonId === "string" && waitingOnPersonId !== "") {
    patch.waitingOnPersonId = waitingOnPersonId;
  }
  if (STATUSES.includes(status as Status)) patch.status = status as Status;
  if (dueDate === null) patch.dueDate = null;
  else if (typeof dueDate === "string" && DATE_RE.test(dueDate)) {
    patch.dueDate = dueDate;
  }
  if (projectId === null) patch.projectId = null;
  else if (typeof projectId === "string") patch.projectId = projectId;
  if (milestoneId === null) patch.milestoneId = null;
  else if (typeof milestoneId === "string") patch.milestoneId = milestoneId;
  // 1=high, 2=medium, 3=low; explicit null clears it.
  if (priority === null) patch.priority = null;
  else if (typeof priority === "number" && [1, 2, 3].includes(priority)) {
    patch.priority = priority;
  }
  // Explicit null clears the rule (and its interval, in the lib).
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

  // Explicit null wakes the task up early.
  if (snoozedUntil === null) patch.snoozedUntil = null;
  else if (typeof snoozedUntil === "string" && DATE_RE.test(snoozedUntil)) {
    patch.snoozedUntil = snoozedUntil;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  let item, next;
  try {
    ({ item, next } = await updateActionItem(id, patch));
  } catch (err) {
    if (err instanceof MilestoneAssignmentError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // `next` is the occurrence spawned by completing a recurring item, if any.
  return NextResponse.json({ item, next: next ?? null });
});

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await deleteActionItem(id);
  return NextResponse.json({ ok: true });
});
