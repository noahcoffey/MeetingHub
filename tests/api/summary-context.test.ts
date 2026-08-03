import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { actionItems, journalEntries } from "@/db/schema";
import { GET as getContext } from "@/app/api/v1/summary-context/route";
import { createMeeting } from "@/lib/meetings";
import { createActionItem, updateActionItem } from "@/lib/action-items";
import { createPerson, addLinkedTitle, createAgendaItem } from "@/lib/people";
import { createProject } from "@/lib/projects";
import { createMilestone } from "@/lib/milestones";
import { getOrCreateEntry } from "@/lib/journal";
import { createStat, setEntryStatValue } from "@/lib/journal-stats";
import type { SummaryContext } from "@/lib/summary-context";
import { call, makeToken, makeWorkspace, resetDb } from "../helpers";

let wsA: string;
let read: string;

// Fixed anchor week: Monday 2026-08-03. weekAhead = 08-03..08-09,
// lastWeek = 07-27..08-02.
const MONDAY = "2026-08-03";

beforeEach(async () => {
  await resetDb();
  wsA = await makeWorkspace("Alpha", { isDefault: true });
  read = await makeToken({ scope: "read" });
});

async function fetchContext(
  workspace: string,
  weekStart?: string,
): Promise<{ status: number; item: SummaryContext }> {
  const res = await call(getContext, {
    bearer: read,
    query: { workspace, ...(weekStart ? { weekStart } : {}) },
  });
  return { status: res.status, item: res.json.item as SummaryContext };
}

describe("GET /api/v1/summary-context", () => {
  it("rejects a non-Monday weekStart", async () => {
    const res = await call(getContext, {
      bearer: read,
      query: { workspace: wsA, weekStart: "2026-08-05" },
    });
    expect(res.status).toBe(400);
  });

  it("defaults weekStart to a Monday when omitted", async () => {
    const { status, item } = await fetchContext(wsA);
    expect(status).toBe(200);
    const [y, m, d] = item.weekStart.split("-").map(Number);
    expect(new Date(Date.UTC(y, m - 1, d)).getUTCDay()).toBe(1);
  });

  it("partitions meetings and tasks across weekAhead and lastWeek", async () => {
    await createMeeting(wsA, {
      title: "Weekly Sync",
      startTime: new Date("2026-08-04T14:00:00Z"),
    });
    await createMeeting(wsA, {
      title: "Retro",
      startTime: new Date("2026-07-29T14:00:00Z"),
    });
    await createActionItem(wsA, { content: "due in week", dueDate: "2026-08-05" });
    await createActionItem(wsA, { content: "overdue", dueDate: "2026-07-30" });
    await createActionItem(wsA, { content: "undated" });

    // Pin completedAt inside the fixed lastWeek window — updateActionItem
    // stamps the real clock, which sits outside the anchor week.
    const done = await createActionItem(wsA, { content: "finished this week" });
    await updateActionItem(done.id, { status: "done" });
    await db
      .update(actionItems)
      .set({ completedAt: new Date("2026-07-30T12:00:00Z") })
      .where(eq(actionItems.id, done.id));
    // Completed long before last week — must be excluded from the review.
    const old = await createActionItem(wsA, { content: "finished long ago" });
    await updateActionItem(old.id, { status: "done" });
    await db
      .update(actionItems)
      .set({ completedAt: new Date("2026-07-10T12:00:00Z") })
      .where(eq(actionItems.id, old.id));

    const { item } = await fetchContext(wsA, MONDAY);
    expect(item.weekAhead.meetings?.map((m) => m.title)).toEqual(["Weekly Sync"]);
    expect(item.lastWeek.meetingsHeld?.map((m) => m.title)).toEqual(["Retro"]);
    expect(item.weekAhead.tasksDue.map((t) => t.content)).toEqual(["due in week"]);
    expect(item.weekAhead.overdueTasks.map((t) => t.content)).toEqual(["overdue"]);
    expect(item.lastWeek.completedTasks.map((t) => t.content)).toEqual([
      "finished this week",
    ]);
    expect(item.trends.openTaskCount).toBe(3);
    // The Retro (no end time) lands in the trend week at 0.5h.
    const trendWeek = item.trends.meetingLoad?.find(
      (w) => w.weekStart === "2026-07-27",
    );
    expect(trendWeek).toMatchObject({ count: 1, hours: 0.5 });
  });

  it("surfaces waiting-on items and agenda for people being met", async () => {
    await createActionItem(wsA, {
      content: "waiting on legal",
      ownerName: "Alice",
    });
    const bob = await createPerson(wsA, { name: "Bob" });
    await addLinkedTitle(bob.id, "Weekly Sync");
    await createAgendaItem(bob.id, "raise budget");
    await createMeeting(wsA, {
      title: "Weekly Sync",
      startTime: new Date("2026-08-04T14:00:00Z"),
    });

    const { item } = await fetchContext(wsA, MONDAY);
    expect(item.nudges.waitingOn).toHaveLength(1);
    expect(item.nudges.waitingOn[0]).toMatchObject({
      content: "waiting on legal",
      who: "Alice",
    });
    expect(item.nudges.agendaForUpcomingMeetings).toHaveLength(1);
    expect(item.nudges.agendaForUpcomingMeetings?.[0]).toMatchObject({
      personName: "Bob",
      nextMeeting: { title: "Weekly Sync" },
    });
    expect(
      item.nudges.agendaForUpcomingMeetings?.[0].items.map((i) => i.content),
    ).toEqual(["raise budget"]);
  });

  it("includes near milestones and project deadlines, excludes far ones", async () => {
    const proj = await createProject(wsA, {
      name: "Launch",
      deadline: "2026-08-14",
    });
    await createMilestone({
      projectId: proj.id,
      name: "Phase 1",
      dueDate: "2026-08-10",
    });
    await createMilestone({
      projectId: proj.id,
      name: "Far future",
      dueDate: "2026-12-01",
    });
    const farProject = await createProject(wsA, {
      name: "Someday",
      deadline: "2027-01-01",
    });
    expect(farProject).toBeTruthy();

    const { item } = await fetchContext(wsA, MONDAY);
    expect(item.weekAhead.milestones?.map((m) => m.name)).toEqual(["Phase 1"]);
    expect(item.weekAhead.milestones?.[0].projectName).toBe("Launch");
    expect(item.weekAhead.projectDeadlines?.map((p) => p.name)).toEqual(["Launch"]);
  });

  it("returns journal excerpts (truncated) and week-over-week stat averages", async () => {
    const entry = await getOrCreateEntry(wsA, "2026-07-29");
    await db
      .update(journalEntries)
      .set({ notes: "a".repeat(2_100) })
      .where(eq(journalEntries.id, entry.id));
    const stat = await createStat(wsA, {
      name: "Productivity",
      type: "scale",
      direction: "good",
    });
    await setEntryStatValue(entry.id, stat.id, 4);
    const prevEntry = await getOrCreateEntry(wsA, "2026-07-21");
    await setEntryStatValue(prevEntry.id, stat.id, 2);

    const { item } = await fetchContext(wsA, MONDAY);
    expect(item.lastWeek.journal?.entries).toHaveLength(1);
    const excerpt = item.lastWeek.journal!.entries[0].notesExcerpt;
    expect(excerpt.length).toBe(2_001); // 2000 chars + ellipsis
    expect(excerpt.endsWith("…")).toBe(true);
    const prod = item.lastWeek.journal!.stats.find((s) => s.name === "Productivity");
    expect(prod).toMatchObject({ weekAvg: 4, prevWeekAvg: 2, direction: "good" });
  });

  it("nulls sections whose workspace feature is disabled, keeps tasks", async () => {
    const wsOff = await makeWorkspace("Minimal", {
      disabledFeatures: ["journal", "meetings", "projects", "people"],
    });
    await createActionItem(wsOff, { content: "still here", dueDate: "2026-08-05" });

    const { item } = await fetchContext(wsOff, MONDAY);
    expect(item.weekAhead.meetings).toBeNull();
    expect(item.lastWeek.meetingsHeld).toBeNull();
    expect(item.lastWeek.journal).toBeNull();
    expect(item.trends.meetingLoad).toBeNull();
    expect(item.weekAhead.milestones).toBeNull();
    expect(item.weekAhead.projectDeadlines).toBeNull();
    expect(item.nudges.agendaForUpcomingMeetings).toBeNull();
    expect(item.weekAhead.tasksDue.map((t) => t.content)).toEqual(["still here"]);
  });
});
