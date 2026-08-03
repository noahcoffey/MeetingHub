import "server-only";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  lt,
  lte,
  not,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  actionItems,
  meetings,
  projectMilestones,
  type ActionItem,
  type NewActionItem,
} from "@/db/schema";
import { endOfDayUtc, startOfDayUtc, todayInAppTz } from "./dates";
import { nextOccurrence, type RecurrenceUnit } from "./recurrence";

export type ActionItemInput = {
  meetingId?: string | null;
  journalEntryId?: string | null;
  content: string;
  ownerName?: string | null;
  dueDate?: string | null; // YYYY-MM-DD
  projectId?: string | null;
  milestoneId?: string | null;
  priority?: number | null; // 1=high, 2=medium, 3=low
  recurrenceUnit?: RecurrenceUnit | null;
  recurrenceInterval?: number | null; // every N units; null/absent = 1
  waitingOnPersonId?: string | null;
};

// "Waiting on" invariant: an item is waiting iff owner === "other". Setting a
// linked person or a free-text name flips owner to "other"; clearing both
// flips it back to "me". Enforced here so clients only ever think in terms of
// { waitingOnPersonId, ownerName }.
function normalizeWaiting(set: Partial<NewActionItem>, current: {
  ownerName: string | null;
  waitingOnPersonId: string | null;
}): void {
  const ownerName =
    set.ownerName !== undefined ? set.ownerName : current.ownerName;
  const personId =
    set.waitingOnPersonId !== undefined
      ? set.waitingOnPersonId
      : current.waitingOnPersonId;
  set.owner = personId || ownerName ? "other" : "me";
}

export async function getActionItem(
  id: string,
): Promise<ActionItem | undefined> {
  const [item] = await db
    .select()
    .from(actionItems)
    .where(eq(actionItems.id, id))
    .limit(1);
  return item;
}

export async function listForMeeting(meetingId: string): Promise<ActionItem[]> {
  return db
    .select()
    .from(actionItems)
    .where(eq(actionItems.meetingId, meetingId))
    .orderBy(asc(actionItems.createdAt));
}

// A recurring occurrence that isn't due yet: completing one spawns the next
// with a future due date, and showing it immediately just invites checking it
// off again (pushing the anchor out week after week). These stay hidden from
// the working lists until their due date arrives.
function scheduledRecurring(): SQL {
  // and() is only undefined when called with no arguments.
  return and(
    isNotNull(actionItems.recurrenceUnit),
    isNotNull(actionItems.dueDate),
    gt(actionItems.dueDate, todayInAppTz()),
  )!;
}

// A manually snoozed item: hidden the same way until its wake date arrives.
function snoozed(): SQL {
  return and(
    isNotNull(actionItems.snoozedUntil),
    gt(actionItems.snoozedUntil, todayInAppTz()),
  )!;
}

// Everything the working lists should hide: not-yet-due recurring + snoozed.
function hiddenFromOpenLists(): SQL {
  return or(scheduledRecurring(), snoozed())!;
}

// All open items (newest first), excluding recurring occurrences that aren't
// due yet and snoozed items. The UI groups them by meeting / today / earlier.
export async function listOpenActionItems(
  workspaceId: string,
): Promise<ActionItem[]> {
  return db
    .select()
    .from(actionItems)
    .where(
      and(
        eq(actionItems.workspaceId, workspaceId),
        eq(actionItems.status, "open"),
        not(hiddenFromOpenLists()),
      ),
    )
    .orderBy(desc(actionItems.createdAt));
}

export type RunwayTask = {
  id: string;
  content: string;
  dueDate: string; // YYYY-MM-DD
  projectId: string | null;
};

// Open due-dated items inside a date window — the Projects runway's task
// markers. Same visibility rule as the open lists: snoozed and not-yet-due
// recurring occurrences stay hidden until eligible.
export async function listOpenDatedItemsInRange(
  workspaceId: string,
  start: string,
  end: string,
): Promise<RunwayTask[]> {
  const rows = await db
    .select({
      id: actionItems.id,
      content: actionItems.content,
      dueDate: actionItems.dueDate,
      projectId: actionItems.projectId,
    })
    .from(actionItems)
    .where(
      and(
        eq(actionItems.workspaceId, workspaceId),
        eq(actionItems.status, "open"),
        isNotNull(actionItems.dueDate),
        gte(actionItems.dueDate, start),
        lte(actionItems.dueDate, end),
        not(hiddenFromOpenLists()),
      ),
    )
    .orderBy(asc(actionItems.dueDate));
  return rows.map((r) => ({ ...r, dueDate: r.dueDate as string }));
}

// Open items created in earlier occurrences of a meeting series (same exact
// title) — the meeting rail's "From last time" prep section.
export type SeriesItem = ActionItem & { meetingStart: Date };
export async function listOpenItemsFromSeries(
  workspaceId: string,
  title: string,
  excludeMeetingId: string,
): Promise<SeriesItem[]> {
  const rows = await db
    .select({ item: actionItems, meetingStart: meetings.startTime })
    .from(actionItems)
    .innerJoin(meetings, eq(actionItems.meetingId, meetings.id))
    .where(
      and(
        eq(actionItems.status, "open"),
        // Scope both sides: the item and the meeting it's joined to.
        eq(meetings.workspaceId, workspaceId),
        eq(meetings.title, title),
        not(eq(meetings.id, excludeMeetingId)),
        not(hiddenFromOpenLists()),
      ),
    )
    .orderBy(desc(meetings.startTime));
  return rows.map((r) => ({ ...r.item, meetingStart: r.meetingStart }));
}

// Open items delegated to a specific person — the person page's Waiting-on list.
export async function listOpenActionItemsWaitingOn(
  personId: string,
): Promise<ActionItem[]> {
  return db
    .select()
    .from(actionItems)
    .where(
      and(
        eq(actionItems.status, "open"),
        eq(actionItems.waitingOnPersonId, personId),
        not(hiddenFromOpenLists()),
      ),
    )
    .orderBy(desc(actionItems.createdAt));
}

// The hidden counterpart: open recurring items waiting for their due date plus
// snoozed items — the Tasks page shows them in a collapsed "Scheduled &
// snoozed" section, ordered by when they'll resurface.
export async function listScheduledActionItems(
  workspaceId: string,
): Promise<ActionItem[]> {
  return db
    .select()
    .from(actionItems)
    .where(
      and(
        eq(actionItems.workspaceId, workspaceId),
        eq(actionItems.status, "open"),
        hiddenFromOpenLists(),
      ),
    )
    .orderBy(
      asc(sql`greatest(${actionItems.snoozedUntil}, ${actionItems.dueDate})`),
    );
}

// All completed items (most recently completed first) — the Tasks page "Completed" view.
export async function listDoneActionItems(
  workspaceId: string,
): Promise<ActionItem[]> {
  return db
    .select()
    .from(actionItems)
    .where(
      and(
        eq(actionItems.workspaceId, workspaceId),
        eq(actionItems.status, "done"),
      ),
    )
    .orderBy(desc(actionItems.completedAt));
}

// Done items completed inside [from, to] (app-tz day bounds) — the weekly
// summary's last-week review. listDoneActionItems returns all history, which
// grows unbounded; this stays a bounded query.
export async function listDoneActionItemsInRange(
  workspaceId: string,
  from: string,
  to: string,
): Promise<ActionItem[]> {
  return db
    .select()
    .from(actionItems)
    .where(
      and(
        eq(actionItems.workspaceId, workspaceId),
        eq(actionItems.status, "done"),
        gte(actionItems.completedAt, startOfDayUtc(from)),
        lt(actionItems.completedAt, endOfDayUtc(to)),
      ),
    )
    .orderBy(desc(actionItems.completedAt));
}

// created/completed timestamps for every task — the reports page derives the
// per-day created / completed / open-count series from these.
export async function listActionItemTimestamps(
  workspaceId: string,
): Promise<{ createdAt: Date; completedAt: Date | null }[]> {
  return db
    .select({
      createdAt: actionItems.createdAt,
      completedAt: actionItems.completedAt,
    })
    .from(actionItems)
    .where(eq(actionItems.workspaceId, workspaceId));
}

// A task's milestone must belong to the task's project. Thrown to the API
// layer, which maps it to a 400 — same convention as the note-attach and
// dependency-edge guards.
export class MilestoneAssignmentError extends Error {
  constructor(readonly reason: "not-found" | "project-mismatch") {
    super(
      reason === "not-found"
        ? "milestone not found"
        : "milestone belongs to a different project",
    );
    this.name = "MilestoneAssignmentError";
  }
}

// Returns the projectId the task must carry to link the milestone: a task
// with no project auto-adopts the milestone's project; a true mismatch throws.
async function resolveMilestoneProject(
  milestoneId: string,
  effectiveProjectId: string | null,
): Promise<string> {
  const [m] = await db
    .select({ projectId: projectMilestones.projectId })
    .from(projectMilestones)
    .where(eq(projectMilestones.id, milestoneId))
    .limit(1);
  if (!m) throw new MilestoneAssignmentError("not-found");
  if (effectiveProjectId !== null && effectiveProjectId !== m.projectId) {
    throw new MilestoneAssignmentError("project-mismatch");
  }
  return m.projectId;
}

export async function createActionItem(
  workspaceId: string,
  input: ActionItemInput,
): Promise<ActionItem> {
  let projectId = input.projectId ?? null;
  const milestoneId = input.milestoneId ?? null;
  if (milestoneId) {
    projectId = await resolveMilestoneProject(milestoneId, projectId);
  }
  const values: NewActionItem = {
    workspaceId,
    meetingId: input.meetingId ?? null,
    journalEntryId: input.journalEntryId ?? null,
    content: input.content,
    ownerName: input.ownerName ?? null,
    waitingOnPersonId: input.waitingOnPersonId ?? null,
    dueDate: input.dueDate ?? null,
    projectId,
    milestoneId,
    priority: input.priority ?? null,
    recurrenceUnit: input.recurrenceUnit ?? null,
    recurrenceInterval: input.recurrenceUnit
      ? Math.max(1, Math.floor(input.recurrenceInterval ?? 1))
      : null,
    source: input.meetingId ? "meeting" : "manual",
  };
  // owner derives from the waiting fields (me unless waiting on someone).
  normalizeWaiting(values, { ownerName: null, waitingOnPersonId: null });
  const [item] = await db.insert(actionItems).values(values).returning();
  return item;
}

export async function updateActionItem(
  id: string,
  patch: {
    content?: string;
    ownerName?: string | null;
    status?: "open" | "done";
    dueDate?: string | null;
    projectId?: string | null;
    milestoneId?: string | null;
    priority?: number | null;
    recurrenceUnit?: RecurrenceUnit | null;
    recurrenceInterval?: number | null;
    snoozedUntil?: string | null;
    waitingOnPersonId?: string | null;
    untaggedDismissedAt?: Date;
  },
): Promise<{ item?: ActionItem; next?: ActionItem }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(actionItems)
      .where(eq(actionItems.id, id));
    if (!existing) return {};

    // The rule the item would have after this patch — a patch can set recurrence
    // and complete in the same request.
    const unit =
      patch.recurrenceUnit !== undefined
        ? patch.recurrenceUnit
        : existing.recurrenceUnit;
    const interval =
      patch.recurrenceInterval !== undefined
        ? patch.recurrenceInterval
        : existing.recurrenceInterval;
    // Only an open→done transition spawns, so re-completing (or completing a
    // reopened copy, which has no rule anymore) can't create duplicates.
    const spawns =
      patch.status === "done" && existing.status === "open" && unit !== null;

    const set: Partial<NewActionItem> = { updatedAt: new Date() };
    if (patch.content !== undefined) set.content = patch.content;
    if (patch.ownerName !== undefined) set.ownerName = patch.ownerName;
    if (patch.waitingOnPersonId !== undefined) {
      set.waitingOnPersonId = patch.waitingOnPersonId;
    }
    if (patch.ownerName !== undefined || patch.waitingOnPersonId !== undefined) {
      normalizeWaiting(set, {
        ownerName: existing.ownerName,
        waitingOnPersonId: existing.waitingOnPersonId,
      });
    }
    if (patch.status !== undefined) {
      set.status = patch.status;
      // Track completion time for reports; clear it if the task is reopened.
      set.completedAt = patch.status === "done" ? new Date() : null;
      // A status change ends any snooze — done doesn't need one, and a
      // reopened task should be visible.
      set.snoozedUntil = null;
    }
    if (patch.snoozedUntil !== undefined) set.snoozedUntil = patch.snoozedUntil;
    if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
    if (patch.projectId !== undefined) set.projectId = patch.projectId;
    // Milestone link: assigning may auto-adopt the milestone's project (task
    // had none) and errors on a true project mismatch; moving/clearing the
    // project without a matching milestone in the same patch drops the link.
    const effectiveProjectId =
      patch.projectId !== undefined ? patch.projectId : existing.projectId;
    if (patch.milestoneId != null) {
      const adopted = await resolveMilestoneProject(
        patch.milestoneId,
        effectiveProjectId,
      );
      set.milestoneId = patch.milestoneId;
      if (adopted !== effectiveProjectId) set.projectId = adopted;
    } else if (patch.milestoneId === null) {
      set.milestoneId = null;
    } else if (
      patch.projectId !== undefined &&
      patch.projectId !== existing.projectId &&
      existing.milestoneId !== null
    ) {
      set.milestoneId = null;
    }
    if (patch.untaggedDismissedAt !== undefined) {
      set.untaggedDismissedAt = patch.untaggedDismissedAt;
    }
    if (patch.priority !== undefined) set.priority = patch.priority;
    if (patch.recurrenceUnit !== undefined) {
      set.recurrenceUnit = patch.recurrenceUnit;
      set.recurrenceInterval =
        patch.recurrenceUnit === null
          ? null
          : Math.max(1, Math.floor(patch.recurrenceInterval ?? 1));
    }
    if (spawns) {
      // The rule moves to the spawned occurrence; the done row becomes a plain
      // historical record (reopening it yields a one-off task).
      set.recurrenceUnit = null;
      set.recurrenceInterval = null;
    }

    const [item] = await tx
      .update(actionItems)
      .set(set)
      .where(eq(actionItems.id, id))
      .returning();
    if (!item || !spawns || unit === null) return { item };

    const dueDate =
      patch.dueDate !== undefined ? patch.dueDate : existing.dueDate;
    const [next] = await tx
      .insert(actionItems)
      .values({
        workspaceId: existing.workspaceId,
        meetingId: existing.meetingId,
        journalEntryId: existing.journalEntryId,
        projectId: item.projectId,
        // A recurring check-in inside a milestone keeps contributing to it.
        milestoneId: item.milestoneId,
        content: item.content,
        // A delegated recurring check-in stays delegated on the next occurrence.
        owner: item.owner,
        ownerName: item.ownerName,
        waitingOnPersonId: item.waitingOnPersonId,
        dueDate: nextOccurrence(dueDate, unit, interval, todayInAppTz()),
        priority: item.priority,
        recurrenceUnit: unit,
        recurrenceInterval: Math.max(1, Math.floor(interval ?? 1)),
        source: existing.source,
      })
      .returning();
    return { item, next };
  });
}

export async function deleteActionItem(id: string): Promise<void> {
  await db.delete(actionItems).where(eq(actionItems.id, id));
}

// Counts for the sidebar Tasks badge + Dashboard: total open, due today, overdue.
export async function getTaskCounts(workspaceId: string): Promise<{
  open: number;
  dueToday: number;
  overdue: number;
}> {
  const today = todayInAppTz();
  const inWorkspace = eq(actionItems.workspaceId, workspaceId);
  const [[openRow], [dueRow], [overdueRow]] = await Promise.all([
    db
      .select({ n: count() })
      .from(actionItems)
      .where(
        and(inWorkspace, eq(actionItems.status, "open"), not(hiddenFromOpenLists())),
      ),
    db
      .select({ n: count() })
      .from(actionItems)
      .where(
        and(inWorkspace, eq(actionItems.status, "open"), eq(actionItems.dueDate, today)),
      ),
    db
      .select({ n: count() })
      .from(actionItems)
      .where(
        and(inWorkspace, eq(actionItems.status, "open"), lt(actionItems.dueDate, today)),
      ),
  ]);
  return {
    open: openRow?.n ?? 0,
    dueToday: dueRow?.n ?? 0,
    overdue: overdueRow?.n ?? 0,
  };
}
