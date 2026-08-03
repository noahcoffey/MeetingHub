import "server-only";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { meetings, type Workspace } from "@/db/schema";
import { getMeetingsInRange } from "./meetings";
import { listDoneActionItemsInRange, listOpenActionItems } from "./action-items";
import { listOpenDatedMilestones } from "./milestones";
import { listProjects } from "./projects";
import { getEntriesInRange } from "./journal";
import { getValuesInRange, listStats } from "./journal-stats";
import {
  listOpenAgendaItemsForPeople,
  listPeople,
  matchPeopleForMeeting,
} from "./people";
import { isFeatureEnabled } from "./workspaces";
import { APP_TIMEZONE, formatDateInTz, shiftDate, startOfWeek, todayInAppTz } from "./dates";

// The aggregate the Sunday-Summary runner consumes — everything the prompt
// needs in one payload, sized for an LLM context: no meeting note bodies,
// journal notes as capped excerpts, completed tasks capped. Sections whose
// workspace feature is DISABLED are null (vs. [] = enabled but empty) so the
// prompt can say "section unavailable" instead of "nothing happened".
// NEVER log any of this content — it's real work data; log ids only.

export type SummaryTask = {
  id: string;
  content: string;
  dueDate: string | null;
  priority: number | null;
  projectName: string | null;
};

export type SummaryContext = {
  workspace: { id: string; name: string };
  weekStart: string;
  ranges: {
    weekAhead: { from: string; to: string };
    lastWeek: { from: string; to: string };
  };
  weekAhead: {
    meetings:
      | {
          id: string;
          title: string;
          startTime: string;
          endTime: string | null;
          projectName: string | null;
        }[]
      | null; // feature: meetings
    tasksDue: SummaryTask[];
    overdueTasks: (SummaryTask & { daysOverdue: number })[];
    milestones:
      | { id: string; name: string; dueDate: string; projectName: string }[]
      | null; // feature: projects; due ≤ weekStart+20d
    projectDeadlines:
      | { id: string; name: string; deadline: string }[]
      | null; // feature: projects; ≤ weekStart+20d
  };
  lastWeek: {
    completedTasks: {
      id: string;
      content: string;
      completedAt: string;
      projectName: string | null;
    }[]; // capped at 200
    meetingsHeld:
      | { id: string; title: string; startTime: string; hasNotes: boolean }[]
      | null; // feature: meetings
    journal: {
      entries: { date: string; notesExcerpt: string }[]; // 2000-char excerpts
      stats: {
        name: string;
        type: string;
        direction: string;
        values: { date: string; value: number | string | null }[];
        weekAvg: number | null;
        prevWeekAvg: number | null;
      }[];
    } | null; // feature: journal
  };
  nudges: {
    waitingOn: {
      id: string;
      content: string;
      who: string | null;
      createdAt: string;
      ageDays: number;
    }[];
    agendaForUpcomingMeetings:
      | {
          personName: string;
          nextMeeting: { title: string; startTime: string };
          items: { content: string; ageDays: number }[];
        }[]
      | null; // features: people + meetings
  };
  trends: {
    meetingLoad: { weekStart: string; count: number; hours: number }[] | null; // 4 weeks ending lastWeek; feature: meetings
    openTaskCount: number;
  };
};

const JOURNAL_EXCERPT_CHARS = 2000;
const TEXT_STAT_CHARS = 500;
const COMPLETED_CAP = 200;
const LOOKAHEAD_DAYS = 20; // milestones/deadlines horizon past weekStart

// Whole days from `from` to `to` (YYYY-MM-DD calendar math).
function daysBetween(from: string, to: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(to) - toUtc(from)) / 86_400_000);
}

function excerpt(text: string, cap: number): string {
  const trimmed = text.trim();
  return trimmed.length > cap ? `${trimmed.slice(0, cap)}…` : trimmed;
}

export async function buildSummaryContext(
  workspace: Workspace,
  weekStart: string,
): Promise<SummaryContext> {
  const id = workspace.id;
  const meetingsEnabled = isFeatureEnabled(workspace, "meetings");
  const projectsEnabled = isFeatureEnabled(workspace, "projects");
  const journalEnabled = isFeatureEnabled(workspace, "journal");
  const peopleEnabled = isFeatureEnabled(workspace, "people");
  const today = todayInAppTz();

  const weekAheadFrom = weekStart;
  const weekAheadTo = shiftDate(weekStart, 6);
  const lastWeekFrom = shiftDate(weekStart, -7);
  const lastWeekTo = shiftDate(weekStart, -1);
  const trendFrom = shiftDate(weekStart, -28); // 4 trend weeks ending lastWeek
  const journalFrom = shiftDate(weekStart, -14); // covers week + prev-week averages

  const [
    openItems,
    completedItems,
    aheadMeetings,
    pastMeetings,
    allProjects,
    openMilestones,
    journalEntries,
    journalStats,
    journalValues,
  ] = await Promise.all([
    listOpenActionItems(id),
    listDoneActionItemsInRange(id, lastWeekFrom, lastWeekTo),
    meetingsEnabled
      ? getMeetingsInRange(id, weekAheadFrom, weekAheadTo)
      : Promise.resolve([]),
    meetingsEnabled
      ? getMeetingsInRange(id, trendFrom, lastWeekTo)
      : Promise.resolve([]),
    listProjects(id, { includeArchived: true }),
    projectsEnabled ? listOpenDatedMilestones(id) : Promise.resolve([]),
    journalEnabled
      ? getEntriesInRange(id, lastWeekFrom, lastWeekTo)
      : Promise.resolve([]),
    journalEnabled ? listStats(id) : Promise.resolve([]),
    journalEnabled
      ? getValuesInRange(id, journalFrom, lastWeekTo)
      : Promise.resolve([]),
  ]);

  const projectName = new Map(allProjects.map((p) => [p.id, p.name]));
  const nameFor = (projectId: string | null) =>
    projectId ? (projectName.get(projectId) ?? null) : null;

  // ---- tasks (always on) ----
  const toTask = (i: (typeof openItems)[number]): SummaryTask => ({
    id: i.id,
    content: i.content,
    dueDate: i.dueDate,
    priority: i.priority,
    projectName: nameFor(i.projectId),
  });
  const tasksDue = openItems
    .filter((i) => i.dueDate && i.dueDate >= weekAheadFrom && i.dueDate <= weekAheadTo)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
    .map(toTask);
  const overdueTasks = openItems
    .filter((i) => i.dueDate && i.dueDate < weekStart)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
    .map((i) => ({
      ...toTask(i),
      daysOverdue: Math.max(0, daysBetween(i.dueDate!, today)),
    }));

  // ---- nudges: waiting-on ----
  const waiting = openItems.filter((i) => i.owner === "other");
  let personNames = new Map<string, string>();
  if (waiting.some((i) => i.waitingOnPersonId) || peopleEnabled) {
    const persons = await listPeople(id);
    personNames = new Map(persons.map((p) => [p.id, p.name]));
  }
  const waitingOn = waiting.map((i) => ({
    id: i.id,
    content: i.content,
    who: i.waitingOnPersonId
      ? (personNames.get(i.waitingOnPersonId) ?? i.ownerName)
      : i.ownerName,
    createdAt: i.createdAt.toISOString(),
    ageDays: Math.max(0, daysBetween(formatDateInTz(i.createdAt, APP_TIMEZONE), today)),
  }));

  // ---- week ahead: meetings / milestones / deadlines ----
  const horizon = shiftDate(weekStart, LOOKAHEAD_DAYS);
  const milestones = projectsEnabled
    ? openMilestones
        .filter((m) => m.dueDate <= horizon)
        .map((m) => ({
          id: m.id,
          name: m.name,
          dueDate: m.dueDate,
          projectName: projectName.get(m.projectId) ?? "",
        }))
    : null;
  const projectDeadlines = projectsEnabled
    ? allProjects
        .filter(
          (p): p is typeof p & { deadline: string } =>
            p.status === "active" && p.deadline !== null && p.deadline <= horizon,
        )
        .sort((a, b) => (a.deadline < b.deadline ? -1 : 1))
        .map((p) => ({ id: p.id, name: p.name, deadline: p.deadline }))
    : null;

  // ---- nudges: agenda items for people being met this week ----
  let agendaForUpcomingMeetings: SummaryContext["nudges"]["agendaForUpcomingMeetings"] =
    null;
  if (peopleEnabled && meetingsEnabled) {
    agendaForUpcomingMeetings = [];
    if (aheadMeetings.length > 0) {
      // getMeetingsInRange strips bodies (and attendees) in SQL; fetch just
      // the attendee lists for the matched ids to run people-matching.
      const attendeeRows = await db
        .select({
          id: meetings.id,
          title: meetings.title,
          attendees: meetings.attendees,
        })
        .from(meetings)
        .where(inArray(meetings.id, aheadMeetings.map((m) => m.id)));
      const byId = new Map(attendeeRows.map((r) => [r.id, r]));

      // Soonest matched meeting per person (aheadMeetings is start-ordered).
      const firstMeeting = new Map<string, { title: string; startTime: string }>();
      for (const m of aheadMeetings) {
        const row = byId.get(m.id);
        if (!row) continue;
        const matched = await matchPeopleForMeeting({
          workspaceId: id,
          title: row.title,
          attendees: row.attendees,
        });
        for (const p of matched) {
          if (!firstMeeting.has(p.id)) {
            firstMeeting.set(p.id, {
              title: m.title,
              startTime: m.startTime.toISOString(),
            });
          }
        }
      }
      const openAgenda = await listOpenAgendaItemsForPeople([...firstMeeting.keys()]);
      const itemsByPerson = new Map<string, typeof openAgenda>();
      for (const item of openAgenda) {
        const list = itemsByPerson.get(item.personId) ?? [];
        list.push(item);
        itemsByPerson.set(item.personId, list);
      }
      for (const [personId, nextMeeting] of firstMeeting) {
        const items = itemsByPerson.get(personId);
        if (!items?.length) continue;
        agendaForUpcomingMeetings.push({
          personName: personNames.get(personId) ?? "",
          nextMeeting,
          items: items.map((a) => ({
            content: a.content,
            ageDays: Math.max(
              0,
              daysBetween(formatDateInTz(a.createdAt, APP_TIMEZONE), today),
            ),
          })),
        });
      }
    }
  }

  // ---- last week: journal ----
  let journal: SummaryContext["lastWeek"]["journal"] = null;
  if (journalEnabled) {
    const valuesByStat = new Map<string, typeof journalValues>();
    for (const v of journalValues) {
      const list = valuesByStat.get(v.statId) ?? [];
      list.push(v);
      valuesByStat.set(v.statId, list);
    }
    journal = {
      entries: journalEntries
        .filter((e) => e.notes.trim().length > 0)
        .map((e) => ({
          date: e.entryDate,
          notesExcerpt: excerpt(e.notes, JOURNAL_EXCERPT_CHARS),
        })),
      stats: journalStats.map((s) => {
        const vals = valuesByStat.get(s.id) ?? [];
        const inWeek = vals.filter((v) => v.entryDate >= lastWeekFrom);
        const prevWeek = vals.filter((v) => v.entryDate < lastWeekFrom);
        const avg = (rows: typeof vals) => {
          const nums = rows
            .map((r) => r.numValue)
            .filter((n): n is number => n !== null);
          return nums.length
            ? nums.reduce((a, b) => a + b, 0) / nums.length
            : null;
        };
        return {
          name: s.name,
          type: s.type,
          direction: s.direction,
          values: inWeek.map((v) => ({
            date: v.entryDate,
            value:
              v.numValue ??
              (v.textValue ? excerpt(v.textValue, TEXT_STAT_CHARS) : null),
          })),
          weekAvg: avg(inWeek),
          prevWeekAvg: avg(prevWeek),
        };
      }),
    };
  }

  // ---- trends: meeting load over the 4 weeks ending lastWeek ----
  let meetingLoad: SummaryContext["trends"]["meetingLoad"] = null;
  if (meetingsEnabled) {
    const weeks = [-28, -21, -14, -7].map((d) => shiftDate(weekStart, d));
    const buckets = new Map(weeks.map((w) => [w, { count: 0, hours: 0 }]));
    for (const m of pastMeetings) {
      const day = formatDateInTz(m.startTime, APP_TIMEZONE);
      const bucket = buckets.get(startOfWeek(day));
      if (!bucket) continue;
      bucket.count += 1;
      // Missing end time counts as a 30-minute slot, same as reports.
      bucket.hours += m.endTime
        ? (m.endTime.getTime() - m.startTime.getTime()) / 3_600_000
        : 0.5;
    }
    meetingLoad = weeks.map((w) => {
      const b = buckets.get(w)!;
      return { weekStart: w, count: b.count, hours: Math.round(b.hours * 10) / 10 };
    });
  }

  return {
    workspace: { id, name: workspace.name },
    weekStart,
    ranges: {
      weekAhead: { from: weekAheadFrom, to: weekAheadTo },
      lastWeek: { from: lastWeekFrom, to: lastWeekTo },
    },
    weekAhead: {
      meetings: meetingsEnabled
        ? aheadMeetings.map((m) => ({
            id: m.id,
            title: m.title,
            startTime: m.startTime.toISOString(),
            endTime: m.endTime ? m.endTime.toISOString() : null,
            projectName: nameFor(m.projectId),
          }))
        : null,
      tasksDue,
      overdueTasks,
      milestones,
      projectDeadlines,
    },
    lastWeek: {
      completedTasks: completedItems.slice(0, COMPLETED_CAP).map((i) => ({
        id: i.id,
        content: i.content,
        completedAt: i.completedAt?.toISOString() ?? "",
        projectName: nameFor(i.projectId),
      })),
      meetingsHeld: meetingsEnabled
        ? pastMeetings
            .filter((m) => formatDateInTz(m.startTime, APP_TIMEZONE) >= lastWeekFrom)
            .map((m) => ({
              id: m.id,
              title: m.title,
              startTime: m.startTime.toISOString(),
              hasNotes: m.hasNotes,
            }))
        : null,
      journal,
    },
    nudges: { waitingOn, agendaForUpcomingMeetings },
    trends: { meetingLoad, openTaskCount: openItems.length },
  };
}
