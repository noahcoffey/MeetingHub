import Link from "next/link";
import { redirect } from "next/navigation";
import {
  todayInAppTz,
  shiftDate,
  formatPrettyDateStr,
  formatDateInTz,
  isWeekendDateStr,
  startOfDayUtc,
  APP_TIMEZONE,
} from "@/lib/dates";
import {
  listStats,
  getValuesInRange,
  statRange,
  type StatDirection,
} from "@/lib/journal-stats";
import { listActionItemTimestamps } from "@/lib/action-items";
import { getMeetingsInRange } from "@/lib/meetings";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { isFeatureEnabled } from "@/lib/workspaces";
import { MetaChart } from "./meta-chart";
import { TrendToggle } from "./trend-toggle";
import { StackedAreaChart, type StackPoint } from "./stacked-area-chart";

export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90];

function shortLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

function mean(vals: number[]): number | null {
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function toneForDirection(d: StatDirection): "prod" | "anx" | "neutral" {
  if (d === "good") return "prod";
  if (d === "bad") return "anx";
  return "neutral";
}

type Point = { date: string; value: number | null };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const { days: daysParam } = await searchParams;
  const days = RANGES.includes(Number(daysParam)) ? Number(daysParam) : 30;
  const end = todayInAppTz();
  const start = shiftDate(end, -(days - 1));
  const startInstant = startOfDayUtc(start).getTime();

  const workspace = await getActiveWorkspace();
  if (!isFeatureEnabled(workspace, "reports")) redirect("/");
  const workspaceId = workspace.id;
  const [stats, statValues, taskTimes, rangeMeetings] = await Promise.all([
    listStats(workspaceId),
    getValuesInRange(workspaceId, start, end),
    listActionItemTimestamps(workspaceId),
    getMeetingsInRange(workspaceId, start, end),
  ]);

  // Index stat values: numeric by (statId → date → value), text by (date → statId → text).
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

  const numericStats = stats.filter((s) => s.type !== "text");
  const textStats = stats.filter((s) => s.type === "text");

  // Per-stat day series + summary headline.
  const statCards = numericStats.map((s) => {
    const perDate = numByStat.get(s.id) ?? new Map<string, number>();
    const points: Point[] = [];
    for (let i = 0; i < days; i++) {
      const date = shiftDate(start, i);
      points.push({ date, value: perDate.has(date) ? perDate.get(date)! : null });
    }
    const vals = points
      .map((p) => p.value)
      .filter((v): v is number => v != null);
    const avg = mean(vals);
    const { min, max } = statRange(s);
    let headline: string;
    if (avg == null) headline = "no data";
    else if (s.type === "boolean") headline = `${Math.round(avg * 100)}% yes`;
    else if (s.type === "scale") headline = `avg ${avg.toFixed(1)} / ${max}`;
    else headline = `avg ${avg.toFixed(1)}${s.config.unit ?? ""}`;
    return {
      id: s.id,
      title: s.name,
      tone: toneForDirection(s.direction as StatDirection),
      points,
      avg,
      min,
      max,
      unit: s.type === "number" ? s.config.unit : undefined,
      headline,
    };
  });

  // Hours in meetings per weekday. Meetings without an end time count as 30
  // minutes — the ICS feed occasionally omits DTEND. All-day and multi-day
  // calendar blocks (OOO, holidays: midnight-anchored starts or >= 24h) are
  // not meetings and would swamp the chart, so they're skipped. Weekends are
  // excluded entirely (this is a work calendar) — otherwise the line dips to
  // zero every seven days and the cycle drowns the actual trend.
  const midnightCheck = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  });
  const loadByDay = new Map<string, number>();
  let meetingCount = 0;
  for (const m of rangeMeetings) {
    const startDate = new Date(m.startTime);
    const startMs = startDate.getTime();
    const endMs = m.endTime ? new Date(m.endTime).getTime() : startMs + 30 * 60_000;
    const hours = Math.max(0, (endMs - startMs) / 3_600_000);
    if (hours >= 24 || midnightCheck.format(startDate) === "00:00") continue;
    const day = formatDateInTz(startDate, APP_TIMEZONE);
    if (isWeekendDateStr(day)) continue;
    loadByDay.set(day, (loadByDay.get(day) ?? 0) + hours);
    meetingCount++;
  }

  // Per-day task counts + baseline of tasks already open before the range.
  const createdByDay = new Map<string, number>();
  const completedByDay = new Map<string, number>();
  let baselineOpen = 0;
  for (const t of taskTimes) {
    const created = new Date(t.createdAt);
    const cDay = formatDateInTz(created, APP_TIMEZONE);
    createdByDay.set(cDay, (createdByDay.get(cDay) ?? 0) + 1);
    const completed = t.completedAt ? new Date(t.completedAt) : null;
    if (completed) {
      const compDay = formatDateInTz(completed, APP_TIMEZONE);
      completedByDay.set(compDay, (completedByDay.get(compDay) ?? 0) + 1);
    }
    const createdBeforeStart = created.getTime() < startInstant;
    const completedBeforeStart =
      completed != null && completed.getTime() < startInstant;
    if (createdBeforeStart && !completedBeforeStart) baselineOpen++;
  }

  // Build the per-day series. Tasks: open backlog at end of each day, split into
  // "carried over" (created before the range) and "new" (created within it).
  const load: Point[] = [];
  const taskStack: StackPoint[] = [];
  for (let i = 0; i < days; i++) {
    const date = shiftDate(start, i);
    // Meeting-free weekdays are honest zeros, not gaps; weekends aren't days
    // that count, so they're left out of the series rather than plotted as 0.
    if (!isWeekendDateStr(date)) {
      load.push({ date, value: Math.round((loadByDay.get(date) ?? 0) * 10) / 10 });
    }

    const endInstant = startOfDayUtc(shiftDate(date, 1)).getTime();
    let total = 0;
    let fresh = 0;
    for (const t of taskTimes) {
      const created = new Date(t.createdAt).getTime();
      const done = t.completedAt ? new Date(t.completedAt).getTime() : null;
      const open = created < endInstant && (done == null || done >= endInstant);
      if (open) {
        total++;
        if (created >= startInstant) fresh++;
      }
    }
    taskStack.push({ date, carried: total - fresh, total });
  }

  const nums = (pts: Point[]) =>
    pts.map((p) => p.value).filter((v): v is number => v != null);
  const loadAvg = mean(nums(load));
  // Whole-hour ceiling so the y-scale label reads as a clean "Nh".
  const loadMax = Math.max(1, Math.ceil(Math.max(0, ...nums(load))));
  const openNow = taskStack[taskStack.length - 1]?.total ?? 0;
  const newNow = openNow - (taskStack[taskStack.length - 1]?.carried ?? 0);
  const taskMax = Math.max(1, ...taskStack.map((p) => p.total));

  // Reflection (text) stats, newest day first.
  const digestDates = Array.from(textByDate.keys())
    .filter((d) => d >= start && d <= end)
    .sort()
    .reverse();

  function Card({
    title,
    subtitle,
    headline,
    points,
    avg,
    tone,
    min,
    max,
    unit,
  }: {
    title: string;
    subtitle?: string;
    headline: string;
    points: Point[];
    avg: number | null;
    tone: "prod" | "anx" | "neutral" | "open" | "created" | "completed" | "load";
    min?: number;
    max?: number;
    unit?: string;
  }) {
    // Axis endpoints come from the series itself — the load chart drops
    // weekends, so its first/last plotted day can differ from the range.
    const axisStart = points[0]?.date ?? start;
    const axisEnd = points[points.length - 1]?.date ?? end;
    return (
      <section className="report-card">
        <div className="report-card-head">
          <h2>{title}</h2>
          <span className="report-avg">{headline}</span>
        </div>
        {subtitle && <p className="report-card-sub">{subtitle}</p>}
        <MetaChart
          days={points}
          avg={avg}
          tone={tone}
          min={min}
          max={max}
          unit={unit}
        />
        <div className="report-axis">
          <span>{shortLabel(axisStart)}</span>
          <span>{shortLabel(axisEnd)}</span>
        </div>
      </section>
    );
  }

  return (
    <div className="page reports-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="muted page-subtitle">
            Trends from your journal stats and action items.
          </p>
        </div>
        <div className="report-controls">
          <TrendToggle />
          <div className="range-toggle">
            {RANGES.map((r) => (
              <Link
                key={r}
                href={`/reports?days=${r}`}
                className={`range-btn ${days === r ? "is-active" : ""}`}
              >
                {r}d
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="report-grid">
        {statCards.map((c) => (
          <Card
            key={c.id}
            title={c.title}
            headline={c.headline}
            points={c.points}
            avg={c.avg}
            tone={c.tone}
            min={c.min}
            max={c.max}
            unit={c.unit}
          />
        ))}
        <Card
          title="Meeting load"
          subtitle="Hours in meetings per day, weekends excluded"
          headline={
            meetingCount > 0 && loadAvg != null
              ? `avg ${loadAvg.toFixed(1)}h/day · ${meetingCount} meetings`
              : "no meetings"
          }
          points={load}
          avg={loadAvg}
          tone="load"
          min={0}
          max={loadMax}
          unit="h"
        />
        <section className="report-card">
          <div className="report-card-head">
            <h2>Open tasks</h2>
            <span className="report-avg">
              now {openNow}
              {openNow > 0 ? ` · ${newNow} new` : ""}
            </span>
          </div>
          <div className="stack-legend">
            <span className="legend-chip-static sa-new-swatch">New</span>
            <span className="legend-chip-static sa-carried-swatch">
              Carried over
            </span>
          </div>
          <StackedAreaChart days={taskStack} max={taskMax} />
          <div className="report-axis">
            <span>{shortLabel(start)}</span>
            <span>{shortLabel(end)}</span>
          </div>
        </section>
      </div>

      {textStats.length > 0 && (
        <section className="report-digest">
          <h2 className="day-tasks-title">Reflections</h2>
          {digestDates.length === 0 ? (
            <p className="muted">No reflections logged in this range.</p>
          ) : (
            <ul className="digest-list">
              {digestDates.map((date) => {
                const byStat = textByDate.get(date)!;
                return (
                  <li className="digest-item" key={date}>
                    <div className="digest-date">
                      {formatPrettyDateStr(date)}
                    </div>
                    {textStats.map((s) => {
                      const text = byStat.get(s.id);
                      if (!text || !text.trim()) return null;
                      return (
                        <div className="digest-block" key={s.id}>
                          <span className="digest-tag">{s.name}</span>
                          <p>{text}</p>
                        </div>
                      );
                    })}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
