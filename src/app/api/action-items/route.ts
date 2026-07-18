import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createActionItem,
  listForMeeting,
  MilestoneAssignmentError,
} from "@/lib/action-items";
import { isRecurrenceUnit } from "@/lib/recurrence";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const meetingId = new URL(req.url).searchParams.get("meetingId");
  if (!meetingId) {
    return NextResponse.json({ error: "meetingId required" }, { status: 400 });
  }
  const items = await listForMeeting(meetingId);
  return NextResponse.json({ items });
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

  const {
    meetingId,
    journalEntryId,
    content,
    ownerName,
    dueDate,
    projectId,
    milestoneId,
    priority,
    recurrenceUnit,
    recurrenceInterval,
    waitingOnPersonId,
  } = (body ?? {}) as {
    meetingId?: unknown;
    journalEntryId?: unknown;
    content?: unknown;
    ownerName?: unknown;
    dueDate?: unknown;
    projectId?: unknown;
    milestoneId?: unknown;
    priority?: unknown;
    recurrenceUnit?: unknown;
    recurrenceInterval?: unknown;
    waitingOnPersonId?: unknown;
  };

  if (typeof content !== "string" || content.trim() === "") {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  const due =
    typeof dueDate === "string" && DATE_RE.test(dueDate) ? dueDate : null;

  const workspaceId = await getActiveWorkspaceId();
  let item;
  try {
    item = await createActionItem(workspaceId, {
    meetingId: typeof meetingId === "string" ? meetingId : null,
    journalEntryId: typeof journalEntryId === "string" ? journalEntryId : null,
    content: content.trim(),
    // Waiting-on: the lib derives owner from these two fields.
    ownerName:
      typeof ownerName === "string" && ownerName.trim() ? ownerName.trim() : null,
    waitingOnPersonId:
      typeof waitingOnPersonId === "string" && waitingOnPersonId !== ""
        ? waitingOnPersonId
        : null,
    dueDate: due,
    projectId: typeof projectId === "string" ? projectId : null,
    milestoneId: typeof milestoneId === "string" ? milestoneId : null,
    // 1=high, 2=medium, 3=low; anything else means unset.
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
  } catch (err) {
    if (err instanceof MilestoneAssignmentError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
  return NextResponse.json({ item }, { status: 201 });
});
