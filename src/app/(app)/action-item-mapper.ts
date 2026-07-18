// Plain data mapping shared by server pages and the client list — no
// "use client" so server components can call it directly.
import type { ActionItem } from "@/db/schema";
import type { RecurrenceUnit } from "@/lib/recurrence";
import { formatDateInTz, APP_TIMEZONE } from "@/lib/dates";

export type ClientItem = {
  id: string;
  content: string;
  dueDate: string | null; // YYYY-MM-DD
  meetingId: string | null;
  journalEntryId: string | null;
  projectId: string | null;
  milestoneId: string | null;
  priority: number | null; // 1=high, 2=medium, 3=low
  recurrenceUnit: RecurrenceUnit | null;
  recurrenceInterval: number | null;
  // Waiting-on: linked person id and/or free-text name (owner === "other").
  waitingOnPersonId: string | null;
  ownerName: string | null;
  createdDay: string; // YYYY-MM-DD in app tz
  completedDay?: string | null; // YYYY-MM-DD in app tz; only set for the "done" variant
};

export function toClientItem(it: ActionItem): ClientItem {
  return {
    id: it.id,
    content: it.content,
    dueDate: it.dueDate,
    meetingId: it.meetingId,
    journalEntryId: it.journalEntryId,
    projectId: it.projectId,
    milestoneId: it.milestoneId,
    priority: it.priority,
    recurrenceUnit: it.recurrenceUnit,
    recurrenceInterval: it.recurrenceInterval,
    waitingOnPersonId: it.owner === "other" ? it.waitingOnPersonId : null,
    ownerName: it.owner === "other" ? it.ownerName : null,
    createdDay: formatDateInTz(new Date(it.createdAt), APP_TIMEZONE),
    completedDay: it.completedAt
      ? formatDateInTz(new Date(it.completedAt), APP_TIMEZONE)
      : null,
  };
}
