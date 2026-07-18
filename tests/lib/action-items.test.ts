import { beforeEach, describe, expect, it } from "vitest";
import {
  createActionItem,
  getTaskCounts,
  listOpenActionItems,
  listScheduledActionItems,
  updateActionItem,
} from "@/lib/action-items";
import { createPerson } from "@/lib/people";
import { shiftDate, todayInAppTz } from "@/lib/dates";
import { makeWorkspace, resetDb } from "../helpers";

let ws: string;

beforeEach(async () => {
  await resetDb();
  ws = await makeWorkspace("Alpha", { isDefault: true });
});

describe("waiting-on invariant", () => {
  it("is 'me' with no waiting fields", async () => {
    const item = await createActionItem(ws, { content: "mine" });
    expect(item.owner).toBe("me");
  });
  it("flips to 'other' with a free-text owner name", async () => {
    const item = await createActionItem(ws, {
      content: "waiting",
      ownerName: "Sara",
    });
    expect(item.owner).toBe("other");
    expect(item.ownerName).toBe("Sara");
  });
  it("flips to 'other' with a linked person", async () => {
    const person = await createPerson(ws, { name: "Sara" });
    const item = await createActionItem(ws, {
      content: "waiting on person",
      waitingOnPersonId: person.id,
    });
    expect(item.owner).toBe("other");
  });
  it("flips back to 'me' when the waiting fields are cleared", async () => {
    const item = await createActionItem(ws, {
      content: "x",
      ownerName: "Sara",
    });
    const { item: updated } = await updateActionItem(item.id, {
      ownerName: null,
    });
    expect(updated?.owner).toBe("me");
  });
});

describe("open list visibility", () => {
  it("hides snoozed tasks until their date, showing them under Scheduled", async () => {
    const item = await createActionItem(ws, { content: "snooze me" });
    const future = shiftDate(todayInAppTz(), 3);
    await updateActionItem(item.id, { snoozedUntil: future });
    const open = await listOpenActionItems(ws);
    expect(open.find((i) => i.id === item.id)).toBeUndefined();
    const scheduled = await listScheduledActionItems(ws);
    expect(scheduled.find((i) => i.id === item.id)).toBeDefined();
  });

  it("hides a recurring occurrence with a future due date", async () => {
    const future = shiftDate(todayInAppTz(), 5);
    const item = await createActionItem(ws, {
      content: "future recurring",
      dueDate: future,
      recurrenceUnit: "week",
    });
    const open = await listOpenActionItems(ws);
    expect(open.find((i) => i.id === item.id)).toBeUndefined();
    const scheduled = await listScheduledActionItems(ws);
    expect(scheduled.find((i) => i.id === item.id)).toBeDefined();
  });

  it("shows a plain open task", async () => {
    const item = await createActionItem(ws, { content: "visible" });
    const open = await listOpenActionItems(ws);
    expect(open.find((i) => i.id === item.id)).toBeDefined();
  });
});

describe("getTaskCounts", () => {
  it("counts open / due-today / overdue", async () => {
    const today = todayInAppTz();
    await createActionItem(ws, { content: "no date" });
    await createActionItem(ws, { content: "due today", dueDate: today });
    await createActionItem(ws, {
      content: "overdue",
      dueDate: shiftDate(today, -2),
    });
    const counts = await getTaskCounts(ws);
    expect(counts.open).toBe(3);
    expect(counts.dueToday).toBe(1);
    expect(counts.overdue).toBe(1);
  });
});

describe("completing a recurring task", () => {
  it("spawns the next occurrence and moves the rule off the done row", async () => {
    const today = todayInAppTz();
    const item = await createActionItem(ws, {
      content: "weekly check-in",
      dueDate: today,
      recurrenceUnit: "week",
      recurrenceInterval: 1,
    });
    const { item: done, next } = await updateActionItem(item.id, {
      status: "done",
    });
    // Done row is a plain historical record — no rule anymore.
    expect(done?.status).toBe("done");
    expect(done?.recurrenceUnit).toBeNull();
    // Spawned occurrence carries the rule and a future due date.
    expect(next).toBeDefined();
    expect(next?.status).toBe("open");
    expect(next?.recurrenceUnit).toBe("week");
    expect(next?.dueDate).toBe(shiftDate(today, 7));
    expect(next?.content).toBe("weekly check-in");
  });

  it("does not spawn for a non-recurring task", async () => {
    const item = await createActionItem(ws, { content: "one-off" });
    const { next } = await updateActionItem(item.id, { status: "done" });
    expect(next).toBeUndefined();
  });
});
