import Link from "next/link";
import {
  getProjectSummaries,
  listProjects,
  listUntagged,
  suggestProjectFor,
} from "@/lib/projects";
import type { CSSProperties } from "react";
import {
  APP_TIMEZONE,
  formatDateInTz,
  formatPrettyDate,
  formatTimeInTz,
  shiftDate,
  todayInAppTz,
} from "@/lib/dates";
import { redirect } from "next/navigation";
import { listOpenDatedItemsInRange } from "@/lib/action-items";
import { listOpenDatedMilestones } from "@/lib/milestones";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { isFeatureEnabled } from "@/lib/workspaces";
import { NewProjectForm } from "./new-project-form";
import { ArchivedProjects } from "./archived-projects";
import { UntaggedTriage, type UntaggedInboxRow } from "./untagged-triage";

export const dynamic = "force-dynamic";

// One runway marker: every open task due that day for that project (or, for
// projectId null, the "No project" lane).
type TaskCluster = {
  dueDate: string;
  projectId: string | null;
  contents: string[];
};

// One runway milestone marker: every open, dated milestone of a project sharing
// a due date (a flag; two-or-more the same day collapse to a count badge).
type MilestoneCluster = {
  dueDate: string;
  projectId: string;
  names: string[];
};

// Soonest deadline first (overdue naturally lands on top); no-deadline projects
// sink to the bottom. Stable sort keeps the name ordering within each group.
function sortByDeadline<T extends { deadline: string | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.deadline === null) return b.deadline === null ? 0 : 1;
    if (b.deadline === null) return -1;
    return a.deadline.localeCompare(b.deadline);
  });
}

function formatShortDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(dt);
}

// Calendar-day difference between two YYYY-MM-DD strings (b - a).
function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

// "5 days overdue" / "due today" / "in 8 days" / "in 3 weeks", plus the
// urgency bucket that drives the status dot and due-cell color.
function dueInfo(
  deadline: string,
  today: string,
): { label: string; tone: "late" | "soon" | "ok" } {
  const diff = daysBetween(today, deadline);
  if (diff < 0) {
    const n = -diff;
    return { label: n === 1 ? "1 day overdue" : `${n} days overdue`, tone: "late" };
  }
  if (diff === 0) return { label: "due today", tone: "soon" };
  if (diff <= 7) {
    return { label: diff === 1 ? "in 1 day" : `in ${diff} days`, tone: "soon" };
  }
  if (diff < 14) return { label: `in ${diff} days`, tone: "ok" };
  return { label: `in ${Math.round(diff / 7)} weeks`, tone: "ok" };
}

// "Thu · 9:30 AM" for meetings within the coming week, "Jul 24 · 9:30 AM" beyond.
function formatMeetingWhen(start: Date, today: string): string {
  const day = formatDateInTz(start, APP_TIMEZONE);
  const dayPart =
    daysBetween(today, day) < 7
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: APP_TIMEZONE,
          weekday: "short",
        }).format(start)
      : formatShortDate(day);
  return `${dayPart} · ${formatTimeInTz(start)}`;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const isArchived = view === "archived";
  const workspace = await getActiveWorkspace();
  if (!isFeatureEnabled(workspace, "projects")) redirect("/");
  const workspaceId = workspace.id;

  if (isArchived) {
    const all = await listProjects(workspaceId, { includeArchived: true });
    const archived = all
      .filter((p) => p.status === "archived")
      .map((p) => ({ id: p.id, name: p.name }));
    return (
      <div className="page">
        <ProjectsToolbar isArchived />
        <ArchivedProjects initial={archived} />
      </div>
    );
  }

  const [summaries, openMilestones] = await Promise.all([
    getProjectSummaries(workspaceId),
    listOpenDatedMilestones(workspaceId),
  ]);
  const today = todayInAppTz();
  const all = sortByDeadline(summaries);

  // First (soonest) open dated milestone per project, for the table column.
  // openMilestones is already sorted dueDate-ascending, so the first hit wins.
  const nextMilestoneByProject = new Map<string, { name: string; dueDate: string }>();
  for (const m of openMilestones) {
    if (!nextMilestoneByProject.has(m.projectId)) {
      nextMilestoneByProject.set(m.projectId, { name: m.name, dueDate: m.dueDate });
    }
  }

  // Runway rows: a project shows if it has a deadline OR at least one open dated
  // milestone (a deadline-less project earns a lane purely for its flags).
  const projectsWithMilestone = new Set(openMilestones.map((m) => m.projectId));
  const dated = all.filter(
    (p) => p.deadline !== null || projectsWithMilestone.has(p.id),
  );

  // Deadline runway domain: a week of room left of today (more if something is
  // further overdue), and at least four weeks out — padded past the last date.
  let runway: {
    x: (d: string) => number;
    todayX: number;
    weekW: number;
    ticks: { x: number; label: string }[];
    // Due-dated open tasks inside the window, clustered per project + day.
    taskClusters: Map<string, TaskCluster[]>;
    unassigned: TaskCluster[];
    // Open dated milestones inside the window, clustered per project + day.
    milestoneClusters: Map<string, MilestoneCluster[]>;
  } | null = null;
  if (dated.length > 0) {
    // Domain unions deadlines and milestone due dates so neither kind of marker
    // ever clamps against the 0%/100% edges.
    const domainDates = [
      ...dated.flatMap((p) => (p.deadline !== null ? [p.deadline] : [])),
      ...openMilestones.map((m) => m.dueDate),
    ].sort();
    const first = domainDates[0];
    const last = domainDates[domainDates.length - 1];
    const start = shiftDate(today, Math.min(-7, daysBetween(today, first) - 4));
    const end = shiftDate(today, Math.max(daysBetween(today, last) + 5, 28));
    const span = daysBetween(start, end);
    const x = (d: string) =>
      Math.min(100, Math.max(0, (daysBetween(start, d) / span) * 100));

    const tasks = await listOpenDatedItemsInRange(workspaceId, start, end);
    const byKey = new Map<string, TaskCluster>();
    for (const t of tasks) {
      const key = `${t.projectId ?? "none"}|${t.dueDate}`;
      const cluster = byKey.get(key) ?? {
        dueDate: t.dueDate,
        projectId: t.projectId,
        contents: [],
      };
      cluster.contents.push(t.content);
      byKey.set(key, cluster);
    }
    const taskClusters = new Map<string, TaskCluster[]>();
    const unassigned: TaskCluster[] = [];
    for (const cluster of byKey.values()) {
      if (cluster.projectId === null) {
        unassigned.push(cluster);
      } else {
        const list = taskClusters.get(cluster.projectId) ?? [];
        list.push(cluster);
        taskClusters.set(cluster.projectId, list);
      }
    }

    const msByKey = new Map<string, MilestoneCluster>();
    for (const m of openMilestones) {
      if (m.dueDate < start || m.dueDate > end) continue;
      const key = `${m.projectId}|${m.dueDate}`;
      const cluster = msByKey.get(key) ?? {
        dueDate: m.dueDate,
        projectId: m.projectId,
        names: [],
      };
      cluster.names.push(m.name);
      msByKey.set(key, cluster);
    }
    const milestoneClusters = new Map<string, MilestoneCluster[]>();
    for (const cluster of msByKey.values()) {
      const list = milestoneClusters.get(cluster.projectId) ?? [];
      list.push(cluster);
      milestoneClusters.set(cluster.projectId, list);
    }

    runway = {
      x,
      todayX: x(today),
      weekW: (7 / span) * 100,
      ticks: [0.38, 0.64, 0.9].map((f) => {
        const date = shiftDate(start, Math.round(span * f));
        return { x: x(date), label: formatShortDate(date) };
      }),
      taskClusters,
      unassigned,
      milestoneClusters,
    };
  }

  let triage: { rows: UntaggedInboxRow[]; projects: ProjectOpt[] } | null = null;
  if (summaries.length > 0) {
    const [untagged, projectOptions] = await Promise.all([
      listUntagged(workspaceId),
      listProjects(workspaceId),
    ]);
    const [meetingSuggestions, itemSuggestions] = await Promise.all([
      Promise.all(
        untagged.meetings.map((m) => suggestProjectFor(workspaceId, m.title)),
      ),
      Promise.all(
        untagged.actionItems.map((it) =>
          suggestProjectFor(workspaceId, it.content),
        ),
      ),
    ]);
    // One inbox: meetings and tasks interleaved, most recent first.
    const rows: (UntaggedInboxRow & { at: number })[] = [
      ...untagged.meetings.map((m, i) => ({
        kind: "meeting" as const,
        id: m.id,
        title: m.title,
        subLabel: `${formatPrettyDate(new Date(m.startTime))} · ${formatTimeInTz(new Date(m.startTime))}`,
        suggested: meetingSuggestions[i],
        at: new Date(m.startTime).getTime(),
      })),
      ...untagged.actionItems.map((it, i) => ({
        kind: "task" as const,
        id: it.id,
        title: it.content,
        subLabel: `Task · created ${formatShortDate(formatDateInTz(new Date(it.createdAt), APP_TIMEZONE))}`,
        suggested: itemSuggestions[i],
        at: new Date(it.createdAt).getTime(),
      })),
    ].sort((a, b) => b.at - a.at);
    triage = {
      rows: rows.map(({ at: _at, ...row }) => row),
      projects: projectOptions.map((p) => ({ id: p.id, name: p.name })),
    };
  }

  return (
    <div className="page">
      <ProjectsToolbar isArchived={false} />
      {summaries.length === 0 ? (
        <p className="muted empty">No projects yet.</p>
      ) : (
        <>
          <div className="projects-table">
            <div className="projects-table-head">
              <span>Project</span>
              <span className="project-row-next">Next meeting</span>
              <span className="project-row-ms">Milestone</span>
              <span>Due</span>
              <span className="project-row-count">Open</span>
            </div>
            {all.map((p) => {
              const due = p.deadline ? dueInfo(p.deadline, today) : null;
              const ms = nextMilestoneByProject.get(p.id);
              const msTone = ms ? dueInfo(ms.dueDate, today).tone : null;
              return (
                <Link key={p.id} href={`/projects/${p.id}`} className="project-row">
                  <span className="project-row-name">
                    <span className={`project-dot ${due?.tone ?? ""}`} />
                    {p.name}
                  </span>
                  <span className="project-row-next">
                    {p.nextMeetingTitle ? (
                      <>
                        <em>{p.nextMeetingTitle}</em>
                        {p.nextMeetingStart && (
                          <small>
                            {formatMeetingWhen(new Date(p.nextMeetingStart), today)}
                          </small>
                        )}
                      </>
                    ) : (
                      <span className="project-next-none">—</span>
                    )}
                  </span>
                  {ms ? (
                    <span className={`project-row-ms ${msTone}`}>
                      <em>{ms.name}</em>
                      <small>
                        {formatShortDate(ms.dueDate)}
                        {ms.dueDate < today ? " · overdue" : ""}
                      </small>
                    </span>
                  ) : (
                    <span className="project-row-ms none">—</span>
                  )}
                  {due && p.deadline ? (
                    <span className={`project-row-due ${due.tone}`}>
                      <em>{due.label}</em>
                      <small>{formatShortDate(p.deadline)}</small>
                    </span>
                  ) : (
                    <span className="project-row-due none">No deadline</span>
                  )}
                  <span className="project-row-count">
                    <span
                      className={`project-count-pill ${
                        p.openTaskCount === 0 ? "zero" : ""
                      }`}
                    >
                      <span className="project-count-num">{p.openTaskCount}</span>
                      <span className="project-count-unit">open</span>
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
          {runway && (
            <>
              <p className="projects-block-label">Deadline runway</p>
              <div
                className="projects-runway"
                style={
                  {
                    "--today-x": `${runway.todayX}%`,
                    "--week-w": `${runway.weekW}%`,
                  } as CSSProperties
                }
              >
                <div className="runway-legend">
                  <span>
                    <i className="rl-bar" />
                    Project deadline
                  </span>
                  <span>
                    <i className="rl-task" />
                    Task due
                  </span>
                  <span>
                    <i className="rl-milestone" />
                    Milestone
                  </span>
                  <span>
                    <i className="rl-late" />
                    Overdue
                  </span>
                </div>
                <div className="runway-grid">
                  <div className="runway-row head">
                    <span />
                    <div className="runway-axis">
                      <b className="runway-today-label" style={{ left: `${runway.todayX}%` }}>
                        Today
                      </b>
                      {runway.ticks.map((t) => (
                        <b key={t.label} style={{ left: `${t.x}%` }}>
                          {t.label}
                        </b>
                      ))}
                    </div>
                    <span />
                  </div>
                  {dated.map((p) => {
                    const r = runway as NonNullable<typeof runway>;
                    const deadline = p.deadline;
                    let bar = null;
                    if (deadline !== null) {
                      const overdue = deadline < today;
                      const endX = r.x(deadline);
                      const left = overdue ? endX : r.todayX;
                      const width = Math.max(
                        0.5,
                        overdue ? r.todayX - endX : endX - r.todayX,
                      );
                      bar = (
                        <>
                          <span
                            className={`runway-bar ${overdue ? "late" : ""}`}
                            style={{ left: `${left}%`, width: `${width}%` }}
                          />
                          <span className="runway-date" style={{ left: `${endX}%` }}>
                            {formatShortDate(deadline)}
                          </span>
                        </>
                      );
                    }
                    return (
                      <Link
                        key={p.id}
                        href={`/projects/${p.id}`}
                        className="runway-row"
                      >
                        <span className="runway-name">{p.name}</span>
                        <span className="runway-track">
                          {bar}
                          {(r.taskClusters.get(p.id) ?? []).map((c) => (
                            <TaskMarker key={c.dueDate} cluster={c} x={r.x} today={today} />
                          ))}
                          {(r.milestoneClusters.get(p.id) ?? []).map((c) => (
                            <MilestoneMarker
                              key={c.dueDate}
                              cluster={c}
                              x={r.x}
                              today={today}
                            />
                          ))}
                        </span>
                        <span className="runway-count">
                          {p.openTaskCount} <small>open</small>
                        </span>
                      </Link>
                    );
                  })}
                  {runway.unassigned.length > 0 && (
                    <div className="runway-row">
                      <span className="runway-name unassigned">No project</span>
                      <span className="runway-track">
                        {runway.unassigned.map((c) => (
                          <TaskMarker
                            key={c.dueDate}
                            cluster={c}
                            x={runway.x}
                            today={today}
                          />
                        ))}
                      </span>
                      <span className="runway-count">
                        {runway.unassigned.reduce((n, c) => n + c.contents.length, 0)}{" "}
                        <small>due</small>
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          {triage && (
            <UntaggedTriage rows={triage.rows} projects={triage.projects} />
          )}
        </>
      )}
    </div>
  );
}

// Diamond for one task, count badge for several due the same day. Tooltip
// carries the task text (single) or the count (cluster).
function TaskMarker({
  cluster,
  x,
  today,
}: {
  cluster: TaskCluster;
  x: (d: string) => number;
  today: string;
}) {
  const late = cluster.dueDate < today;
  const left = `${x(cluster.dueDate)}%`;
  const when = formatShortDate(cluster.dueDate);
  if (cluster.contents.length === 1) {
    return (
      <span
        className={`runway-task ${late ? "late" : ""}`}
        style={{ left }}
        title={`${cluster.contents[0]} — ${when}${late ? " (overdue)" : ""}`}
      />
    );
  }
  return (
    <span
      className={`runway-task-badge ${late ? "late" : ""}`}
      style={{ left }}
      title={`${cluster.contents.length} tasks due ${when}${late ? " (overdue)" : ""}`}
    >
      {cluster.contents.length}
    </span>
  );
}

// Flag for one milestone, count badge for several due the same day. Flags rise
// above the track so they never collide with the task diamonds below.
function MilestoneMarker({
  cluster,
  x,
  today,
}: {
  cluster: MilestoneCluster;
  x: (d: string) => number;
  today: string;
}) {
  const late = cluster.dueDate < today;
  const left = `${x(cluster.dueDate)}%`;
  const when = formatShortDate(cluster.dueDate);
  if (cluster.names.length === 1) {
    return (
      <span
        className={`runway-milestone ${late ? "late" : ""}`}
        style={{ left }}
        title={`Milestone: ${cluster.names[0]} — ${when}${late ? " (overdue)" : ""}`}
      />
    );
  }
  return (
    <span
      className={`runway-milestone-badge ${late ? "late" : ""}`}
      style={{ left }}
      title={`Milestones: ${cluster.names.join(", ")} — ${when}${late ? " (overdue)" : ""}`}
    >
      {cluster.names.length}
    </span>
  );
}

type ProjectOpt = { id: string; name: string };

function ProjectsToolbar({ isArchived }: { isArchived: boolean }) {
  return (
    <div className="day-toolbar">
      <div className="day-toolbar-id">
        <h1 className="page-title">Projects</h1>
        <p className="muted page-subtitle">
          {isArchived ? "Archived projects." : "Active projects and their open work."}
        </p>
      </div>
      <div className="day-toolbar-controls">
        <div className="range-toggle view-toggle">
          <Link href="/projects" className={`range-btn ${!isArchived ? "is-active" : ""}`}>
            Active
          </Link>
          <Link
            href="/projects?view=archived"
            className={`range-btn ${isArchived ? "is-active" : ""}`}
          >
            Archived
          </Link>
        </div>
        {!isArchived && <NewProjectForm />}
      </div>
    </div>
  );
}
