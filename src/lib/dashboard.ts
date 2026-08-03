import "server-only";
import { getMeetingsForDate } from "./meetings";
import { getTaskCounts } from "./action-items";
import { getOrCreateEntry } from "./journal";
import {
  listStats,
  getValuesInRange,
  statRange,
  type StatDirection,
} from "./journal-stats";
import { listProjects } from "./projects";
import { listOpenDatedMilestones } from "./milestones";
import { isFeatureEnabled } from "./workspaces";
import { hourInAppTz, shiftDate, startOfWeek, todayInAppTz } from "./dates";
import type { Workspace } from "@/db/schema";

export type TrendDirection = "up" | "down" | "flat";

function mean(vals: number[]): number | null {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

// Direction-only — deliberately not color-coded good/bad, since a rising trend
// means something different for productivity than for anxiety.
function trend(current: number | null, previous: number | null): TrendDirection {
  if (current == null || previous == null) return "flat";
  const diff = current - previous;
  if (diff > 0.3) return "up";
  if (diff < -0.3) return "down";
  return "flat";
}

function toneForDirection(d: StatDirection): "prod" | "anx" | "neutral" {
  if (d === "good") return "prod";
  if (d === "bad") return "anx";
  return "neutral";
}

export type SparkPoint = { date: string; value: number | null };

// A dashboard trend card for one numeric journal stat flagged show_on_dashboard.
export type DashboardStatCard = {
  id: string;
  name: string;
  tone: "prod" | "anx" | "neutral";
  isBoolean: boolean;
  avg: number | null;
  trend: TrendDirection;
  points: SparkPoint[];
  min: number;
  max: number;
  unit?: string;
};

// A day's text-stat reflections, for the week digest.
export type WeekReflection = {
  date: string;
  items: { name: string; text: string }[];
};

export type DashboardData = {
  nextMeeting: { id: string; title: string; startTime: string } | null;
  currentMeeting: { id: string; title: string } | null;
  meetingsTotal: number;
  meetingsDone: number;
  statCards: DashboardStatCard[];
  tasks: { open: number; dueToday: number; overdue: number };
  journalEntry: {
    id: string;
    entryDate: string;
    notes: string;
    notesUpdatedAt: string;
  } | null;
  weekDigest: WeekReflection[];
  projects: {
    activeCount: number;
    // Soonest upcoming checkpoint — a milestone or a bare project deadline,
    // whichever lands first (ties go to the milestone). milestoneName null
    // means it's a plain deadline.
    nextCheckpoint: {
      projectName: string;
      milestoneName: string | null;
      date: string;
    } | null;
  };
  features: { meetings: boolean; journal: boolean; projects: boolean };
};

export async function getDashboardData(
  workspace: Workspace,
): Promise<DashboardData> {
  const workspaceId = workspace.id;
  const meetingsEnabled = isFeatureEnabled(workspace, "meetings");
  const journalEnabled = isFeatureEnabled(workspace, "journal");
  const projectsEnabled = isFeatureEnabled(workspace, "projects");
  const today = todayInAppTz();
  // The journal card looks back at yesterday through most of the day, then
  // flips to today's entry at 4pm app-tz — late-afternoon journaling is about
  // the day that's wrapping up, not the one before.
  const journalDate = hourInAppTz() >= 16 ? today : shiftDate(today, -1);
  const weekStart = startOfWeek(today);
  // Rolling 7-day window (today inclusive) vs. the 7 days before that, for the trend arrow.
  const rollingStart = shiftDate(today, -6);
  const prevRollingStart = shiftDate(today, -13);
  const prevRollingEnd = shiftDate(today, -7);

  // One values fetch covers the whole window we need: prev-rolling start
  // (today-13) is the earliest, week start is within it.
  const valuesStart =
    prevRollingStart < weekStart ? prevRollingStart : weekStart;

  const [
    meetings,
    tasks,
    stats,
    statValues,
    journalEntry,
    activeProjects,
    openMilestones,
  ] = await Promise.all([
    meetingsEnabled ? getMeetingsForDate(workspaceId, today) : Promise.resolve([]),
    getTaskCounts(workspaceId),
    journalEnabled ? listStats(workspaceId) : Promise.resolve([]),
    journalEnabled
      ? getValuesInRange(workspaceId, valuesStart, today)
      : Promise.resolve([]),
    journalEnabled ? getOrCreateEntry(workspaceId, journalDate) : Promise.resolve(null),
    projectsEnabled ? listProjects(workspaceId) : Promise.resolve([]),
    projectsEnabled
      ? listOpenDatedMilestones(workspaceId)
      : Promise.resolve([]),
  ]);

  const now = new Date();
  const currentMeeting = meetings.find((m) => {
    const start = new Date(m.startTime);
    const end = m.endTime ? new Date(m.endTime) : null;
    return start <= now && end !== null && now < end;
  });
  const upcoming = meetings.find((m) => new Date(m.startTime) > now);
  const meetingsDone = meetings.filter((m) => {
    const end = new Date(m.endTime ?? m.startTime);
    return end <= now;
  }).length;

  // Index values: numeric by (statId → date → value), text by (date → statId → text).
  const numByStat = new Map<string, Map<string, number>>();
  const textByDate = new Map<string, Map<string, string>>();
  for (const v of statValues) {
    if (v.numValue != null) {
      let m = numByStat.get(v.statId);
      if (!m) numByStat.set(v.statId, (m = new Map()));
      m.set(v.entryDate, v.numValue);
    }
    if (v.textValue != null && v.textValue.trim()) {
      let m = textByDate.get(v.entryDate);
      if (!m) textByDate.set(v.entryDate, (m = new Map()));
      m.set(v.statId, v.textValue);
    }
  }

  // One trend card per dashboard-flagged numeric stat: rolling-7 avg + sparkline,
  // and the arrow compares against the previous 7 days.
  const dashStats = stats.filter(
    (s) => s.showOnDashboard && s.type !== "text",
  );
  const statCards: DashboardStatCard[] = dashStats.map((s) => {
    const perDate = numByStat.get(s.id) ?? new Map<string, number>();
    const points: SparkPoint[] = [];
    const rollingVals: number[] = [];
    for (let i = 0; i < 7; i++) {
      const date = shiftDate(rollingStart, i);
      const v = perDate.has(date) ? perDate.get(date)! : null;
      points.push({ date, value: v });
      if (v != null) rollingVals.push(v);
    }
    const prevVals: number[] = [];
    for (let i = 0; i < 7; i++) {
      const date = shiftDate(prevRollingStart, i);
      if (perDate.has(date)) prevVals.push(perDate.get(date)!);
    }
    const avg = mean(rollingVals);
    const { min, max } = statRange(s);
    return {
      id: s.id,
      name: s.name,
      tone: toneForDirection(s.direction as StatDirection),
      isBoolean: s.type === "boolean",
      avg,
      trend: trend(avg, mean(prevVals)),
      points,
      min,
      max,
      unit: s.type === "number" ? s.config.unit : undefined,
    };
  });

  // Week digest: text-stat reflections logged this calendar week, newest first.
  const textStats = stats.filter((s) => s.type === "text");
  const weekDigest: WeekReflection[] = Array.from(textByDate.keys())
    .filter((d) => d >= weekStart && d <= today)
    .sort()
    .reverse()
    .map((date) => {
      const byStat = textByDate.get(date)!;
      return {
        date,
        items: textStats
          .filter((s) => (byStat.get(s.id) ?? "").trim())
          .map((s) => ({ name: s.name, text: byStat.get(s.id)! })),
      };
    })
    .filter((r) => r.items.length > 0);

  const withDeadline = activeProjects
    .filter((p): p is typeof p & { deadline: string } => p.deadline !== null)
    .sort((a, b) => a.deadline.localeCompare(b.deadline));

  // Whichever comes sooner: the nearest project deadline or the nearest open
  // dated milestone (openMilestones is already sorted soonest-first). A tie
  // favours the milestone — it's the more actionable checkpoint.
  const nearestDeadline = withDeadline[0] ?? null;
  const nearestMilestone = openMilestones[0] ?? null;
  const projectNameById = new Map(activeProjects.map((p) => [p.id, p.name]));
  let nextCheckpoint: DashboardData["projects"]["nextCheckpoint"] = null;
  if (
    nearestMilestone &&
    (!nearestDeadline || nearestMilestone.dueDate <= nearestDeadline.deadline)
  ) {
    nextCheckpoint = {
      projectName: projectNameById.get(nearestMilestone.projectId) ?? "",
      milestoneName: nearestMilestone.name,
      date: nearestMilestone.dueDate,
    };
  } else if (nearestDeadline) {
    nextCheckpoint = {
      projectName: nearestDeadline.name,
      milestoneName: null,
      date: nearestDeadline.deadline,
    };
  }

  return {
    nextMeeting: upcoming
      ? {
          id: upcoming.id,
          title: upcoming.title,
          startTime: upcoming.startTime.toISOString(),
        }
      : null,
    currentMeeting: currentMeeting
      ? { id: currentMeeting.id, title: currentMeeting.title }
      : null,
    meetingsTotal: meetings.length,
    meetingsDone,
    statCards,
    tasks,
    journalEntry: journalEntry
      ? {
          id: journalEntry.id,
          entryDate: journalEntry.entryDate,
          notes: journalEntry.notes,
          notesUpdatedAt: journalEntry.notesUpdatedAt.toISOString(),
        }
      : null,
    weekDigest,
    projects: {
      activeCount: activeProjects.length,
      nextCheckpoint,
    },
    features: {
      meetings: meetingsEnabled,
      journal: journalEnabled,
      projects: projectsEnabled,
    },
  };
}
