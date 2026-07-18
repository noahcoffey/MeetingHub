import Link from "next/link";
import {
  listOpenActionItems,
  listDoneActionItems,
  listScheduledActionItems,
} from "@/lib/action-items";
import { listProjects } from "@/lib/projects";
import { listDependencyEdges } from "@/lib/task-dependencies";
import { recurrenceLabel } from "@/lib/recurrence";
import { todayInAppTz, formatDateInTz, APP_TIMEZONE } from "@/lib/dates";
import { ActionItemsList } from "../action-items-list";
import { toClientItem, type ClientItem } from "../action-item-mapper";
import { listPeopleNames } from "@/lib/people";
import { getActiveWorkspaceId } from "@/lib/workspace-context";
import { TaskDependenciesView, type EnrichedEdge, type TaskNode } from "./task-dependencies-view";
import { ScheduledTasks, type ScheduledTaskRow } from "./scheduled-tasks";

export const dynamic = "force-dynamic";

const GROUP_BY_PROP = {
  created: "created",
  due: "due",
  group: "project",
  priority: "priority",
  waiting: "waiting",
} as const;
type GroupByParam = keyof typeof GROUP_BY_PROP;

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; groupBy?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "done" ? "done" : params.view === "deps" ? "deps" : "open";
  const groupByParam: GroupByParam =
    params.groupBy === "created" ||
    params.groupBy === "group" ||
    params.groupBy === "priority" ||
    params.groupBy === "waiting"
      ? params.groupBy
      : "due";

  const workspaceId = await getActiveWorkspaceId();

  if (view === "deps") {
    const [openRows, doneRows, scheduledRows, edges] = await Promise.all([
      listOpenActionItems(workspaceId),
      listDoneActionItems(workspaceId),
      listScheduledActionItems(workspaceId),
      listDependencyEdges(workspaceId),
    ]);
    // Scheduled recurring tasks aren't draggable nodes, but edges may point at
    // them — keep them resolvable so they don't read as "(deleted task)".
    const byId = new Map(
      [...openRows, ...doneRows, ...scheduledRows].map((it) => [it.id, it]),
    );
    const nodes: TaskNode[] = openRows.map((it) => ({ id: it.id, content: it.content }));
    const enrichedEdges: EnrichedEdge[] = edges.map((e) => ({
      id: e.id,
      taskId: e.taskId,
      dependsOnId: e.dependsOnId,
      dependsOnContent: byId.get(e.dependsOnId)?.content ?? "(deleted task)",
      dependsOnStatus: byId.get(e.dependsOnId)?.status ?? "done",
    }));

    return (
      <div className="page tasks-page">
        <TasksToolbar view={view} groupBy={groupByParam} />
        <div className="tasks-list-wrap">
          <TaskDependenciesView initialNodes={nodes} initialEdges={enrichedEdges} />
        </div>
      </div>
    );
  }

  const isDone = view === "done";
  const [rows, projects, dependencyEdges, scheduled, peopleOptions] =
    await Promise.all([
      isDone ? listDoneActionItems(workspaceId) : listOpenActionItems(workspaceId),
      listProjects(workspaceId),
      isDone ? Promise.resolve([]) : listDependencyEdges(workspaceId),
      isDone ? Promise.resolve([]) : listScheduledActionItems(workspaceId),
      listPeopleNames(workspaceId),
    ]);
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  const items: ClientItem[] = rows.map(toClientItem);

  // taskId -> "Blocked by: X, Y" for tasks with at least one unmet dependency.
  let dependencyInfo: Map<string, string> | undefined;
  if (!isDone) {
    const contentById = new Map(rows.map((it) => [it.id, it.content]));
    const byTask = new Map<string, string[]>();
    for (const e of dependencyEdges) {
      const dep = contentById.get(e.dependsOnId);
      // Only rows still in the open list are unmet — a done dependency isn't blocking.
      if (!dep) continue;
      const list = byTask.get(e.taskId) ?? [];
      list.push(dep);
      byTask.set(e.taskId, list);
    }
    dependencyInfo = new Map(
      [...byTask.entries()].map(([taskId, names]) => [taskId, `Blocked by: ${names.join(", ")}`]),
    );
  }

  return (
    <div className="page tasks-page">
      <TasksToolbar view={view} groupBy={groupByParam} />
      <div className="tasks-list-wrap">
        <ActionItemsList
          today={todayInAppTz()}
          initialItems={items}
          variant={isDone ? "done" : "open"}
          projects={projectOptions}
          showProjectPrefix={isDone}
          metaLayout="inline"
          groupBy={!isDone ? GROUP_BY_PROP[groupByParam] : undefined}
          dependencyInfo={dependencyInfo}
          people={peopleOptions}
        />
        {!isDone && scheduled.length > 0 && (
          <ScheduledTasks
            initialItems={scheduled.map((it): ScheduledTaskRow => {
              const today = todayInAppTz();
              const isSnoozed = it.snoozedUntil !== null && it.snoozedUntil > today;
              const parts: string[] = [];
              if (it.recurrenceUnit) {
                parts.push(recurrenceLabel(it.recurrenceUnit, it.recurrenceInterval));
              }
              if (isSnoozed) parts.push("Snoozed");
              // Hidden while either condition holds, so it resurfaces at the later date.
              const resurface = [it.snoozedUntil, it.dueDate]
                .filter((d): d is string => d !== null)
                .sort()
                .pop();
              return {
                id: it.id,
                content: it.content,
                meta: `${parts.join(" · ")} · resurfaces ${
                  resurface ? formatShortDateStr(resurface) : "—"
                }`,
                snoozed: isSnoozed,
              };
            })}
          />
        )}
      </div>
    </div>
  );
}

// "Jul 22" from a YYYY-MM-DD string (UTC-noon anchored).
function formatShortDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(dt);
}

function TasksToolbar({
  view,
  groupBy,
}: {
  view: "open" | "done" | "deps";
  groupBy: GroupByParam;
}) {
  const subtitle =
    view === "done"
      ? "Completed action items."
      : view === "deps"
        ? "Drag between tasks to set a dependency."
        : "All open action items.";
  return (
    <div className="day-toolbar">
      <div className="day-toolbar-id">
        <h1 className="page-title">Tasks</h1>
        <p className="muted page-subtitle">{subtitle}</p>
      </div>
      <div className="day-toolbar-controls">
        {view === "open" && (
          <div className="range-toggle group-by-toggle">
            <Link
              href="/tasks?groupBy=created"
              className={`range-btn ${groupBy === "created" ? "is-active" : ""}`}
            >
              Created
            </Link>
            <Link
              href="/tasks?groupBy=due"
              className={`range-btn ${groupBy === "due" ? "is-active" : ""}`}
            >
              Due
            </Link>
            <Link
              href="/tasks?groupBy=group"
              className={`range-btn ${groupBy === "group" ? "is-active" : ""}`}
            >
              Group
            </Link>
            <Link
              href="/tasks?groupBy=priority"
              className={`range-btn ${groupBy === "priority" ? "is-active" : ""}`}
            >
              Priority
            </Link>
            <Link
              href="/tasks?groupBy=waiting"
              className={`range-btn ${groupBy === "waiting" ? "is-active" : ""}`}
            >
              Waiting
            </Link>
          </div>
        )}
        <div className="range-toggle view-toggle">
          <Link href="/tasks" className={`range-btn ${view === "open" ? "is-active" : ""}`}>
            Open
          </Link>
          <Link
            href="/tasks?view=done"
            className={`range-btn ${view === "done" ? "is-active" : ""}`}
          >
            Completed
          </Link>
          <Link
            href="/tasks?view=deps"
            className={`range-btn ${view === "deps" ? "is-active" : ""}`}
          >
            Dependencies
          </Link>
        </div>
      </div>
    </div>
  );
}
