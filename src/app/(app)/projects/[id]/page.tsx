import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getProject,
  listMeetingsForProject,
  listActionItemsForProject,
  listProjects,
} from "@/lib/projects";
import { listLinksForProject } from "@/lib/project-links";
import { listMilestonesForProject } from "@/lib/milestones";
import { listNotesForProject } from "@/lib/notes";
import {
  formatPrettyDate,
  formatTimeInTz,
  formatDateInTz,
  todayInAppTz,
  shiftDate,
  APP_TIMEZONE,
} from "@/lib/dates";
import type { Meeting } from "@/db/schema";
import { ActionItemsList } from "../../action-items-list";
import { toClientItem } from "../../action-item-mapper";
import { ProjectHeader } from "./project-header";
import { ProjectLinks } from "../project-links";
import { ProjectMilestones } from "../project-milestones";
import { ProjectTimeline } from "../project-timeline";
import { ProjectLog, type LogFutureNode } from "./project-log";
import { detectLinkType, LINK_TYPE_LABEL } from "@/lib/link-type";
import { LinkFavicon } from "../link-favicon";
import { AddLinkButton } from "../add-link-button";
import { FilesLinksCard } from "../files-links-card";
import { NewNoteButton } from "../../notes/new-note-button";
import { FileBrowser } from "../../files/file-browser";
import { getWorkspaceById, isFeatureEnabled } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

const TABS = ["overview", "tasks", "milestones", "meetings", "notes", "links", "files"] as const;
type Tab = (typeof TABS)[number];

function formatUpdatedShort(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
}

function formatLogDate(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    month: "short",
    day: "numeric",
  }).format(d);
}

// "Jul 21" from a YYYY-MM-DD string (UTC-noon anchored).
function formatShortDateStr(dateStr: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(parseDateStr(dateStr));
}

// YYYY-MM-DD → UTC-noon Date, for chronological sorting alongside meeting dates.
function parseDateStr(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

// Plain-text excerpt of a markdown body for the latest-note preview.
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+(\[[ xX]\]\s*)?/gm, "")
    .replace(/(\*\*|__|~~|\*|_)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// One row in the project log: meetings, note updates, and task completions
// interleaved, newest first. Everything here is already in the DB.
type LogEntry = {
  key: string;
  date: Date;
  kind: "meeting" | "note" | "task" | "milestone";
  title: string;
  sub?: string;
  href?: string;
};

function MeetingList({ meetings }: { meetings: Meeting[] }) {
  return (
    <ul className="hub-meeting-list">
      {meetings.map((m) => (
        <li key={m.id}>
          <Link href={`/meetings/${m.id}`} className="hub-meeting-row">
            <span className="hub-meeting-title">{m.title}</span>
            <span className="hub-meeting-time">
              {formatPrettyDate(new Date(m.startTime))} ·{" "}
              {formatTimeInTz(new Date(m.startTime))}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function ProjectDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: tabParam } = await searchParams;

  const project = await getProject(id);
  if (!project) notFound();

  // Scope by the project's own workspace (deep-link safe), not the cookie.
  const workspace = await getWorkspaceById(project.workspaceId);
  const filesEnabled =
    workspace !== undefined && isFeatureEnabled(workspace, "files");
  // Links live inside the unified Files & Links tab; the standalone Links tab
  // only exists as the fallback when the files feature is off.
  const visibleTabs = filesEnabled
    ? TABS.filter((t) => t !== "links")
    : TABS.filter((t) => t !== "files");

  // Old ?tab=links deep-links land on the merged tab.
  const requestedTab = tabParam === "links" && filesEnabled ? "files" : tabParam;
  const tab: Tab = (visibleTabs as readonly string[]).includes(requestedTab ?? "")
    ? (requestedTab as Tab)
    : "overview";

  const [meetings, actionItems, projects, links, notes, milestones] =
    await Promise.all([
      listMeetingsForProject(id),
      listActionItemsForProject(id),
      listProjects(project.workspaceId),
      listLinksForProject(id),
      listNotesForProject(id),
      listMilestonesForProject(id),
    ]);
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  const today = todayInAppTz();
  // Match listOpenActionItems: recurring occurrences that aren't due yet and
  // snoozed items stay hidden here too (they resurface when their date arrives).
  const openItems = actionItems
    .filter(
      (it) =>
        it.status === "open" &&
        !(it.recurrenceUnit && it.dueDate && it.dueDate > today) &&
        !(it.snoozedUntil && it.snoozedUntil > today),
    )
    .map(toClientItem);
  const doneItems = actionItems.filter((it) => it.status === "done").map(toClientItem);
  const overdueCount = openItems.filter(
    (it) => it.dueDate !== null && it.dueDate < today,
  ).length;

  const openMilestones = milestones.filter((m) => m.completedAt === null);
  const completedMilestones = milestones.filter((m) => m.completedAt !== null);

  const now = new Date();
  const upcomingMeetings = meetings
    .filter((m) => new Date(m.startTime) >= now)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const pastMeetings = meetings.filter((m) => new Date(m.startTime) < now);

  // ---- Overview data ----
  const nextMeeting = upcomingMeetings[0];
  const dueBeforeNext = nextMeeting
    ? openItems.filter(
        (it) =>
          it.dueDate !== null &&
          it.dueDate <= formatDateInTz(new Date(nextMeeting.startTime), APP_TIMEZONE),
      ).length
    : 0;


  const weekEnd = shiftDate(today, 7);
  const dueSoon = openItems
    .filter((it) => it.dueDate !== null && it.dueDate <= weekEnd)
    .sort((a, b) => (a.dueDate! < b.dueDate! ? -1 : 1))
    .slice(0, 6);

  // Action-item counts per meeting, for the log sublines.
  const itemCountByMeeting = new Map<string, number>();
  for (const it of actionItems) {
    if (it.meetingId) {
      itemCountByMeeting.set(it.meetingId, (itemCountByMeeting.get(it.meetingId) ?? 0) + 1);
    }
  }

  const logEntries: LogEntry[] = [
    ...pastMeetings.map((m): LogEntry => {
      const parts: string[] = [];
      if (m.notes.trim()) parts.push("Notes taken");
      const n = itemCountByMeeting.get(m.id) ?? 0;
      if (n > 0) parts.push(`${n} action item${n === 1 ? "" : "s"}`);
      return {
        key: `m-${m.id}`,
        date: new Date(m.startTime),
        kind: "meeting",
        title: `Meeting: ${m.title}`,
        sub: parts.join(" · ") || undefined,
        href: `/meetings/${m.id}`,
      };
    }),
    ...notes.map(
      (n): LogEntry => ({
        key: `n-${n.id}`,
        date: n.updatedAt,
        kind: "note",
        title: `Note: ${n.title || "Untitled"}`,
        sub: stripMarkdown(n.body).slice(0, 120) || undefined,
        href: `/notes/${n.id}`,
      }),
    ),
    ...actionItems
      .filter((it) => it.status === "done" && it.completedAt)
      .map(
        (it): LogEntry => ({
          key: `t-${it.id}`,
          date: new Date(it.completedAt!),
          kind: "task",
          title: `Completed: ${it.content}`,
        }),
      ),
    ...completedMilestones.map(
      (m): LogEntry => ({
        key: `ms-${m.id}`,
        date: m.completedAt!,
        kind: "milestone",
        title: `Milestone reached: ${m.name}`,
        href: `/projects/${project.id}?tab=milestones`,
      }),
    ),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  // Upcoming rail: deadline, next meetings, and future open milestones together,
  // soonest first.
  const futureNodes: LogFutureNode[] = [
    ...(project.status === "active" && project.deadline && project.deadline >= today
      ? [
          {
            key: "deadline",
            kind: "deadline" as const,
            sortDate: parseDateStr(project.deadline),
            dateLabel: `Upcoming · ${formatShortDateStr(project.deadline)}`,
            title: "Project deadline" as ReactNode,
          },
        ]
      : []),
    ...upcomingMeetings.slice(0, 3).map(
      (m): LogFutureNode => ({
        key: `u-${m.id}`,
        kind: "meeting",
        sortDate: new Date(m.startTime),
        dateLabel: `Upcoming · ${formatLogDate(new Date(m.startTime))}`,
        title: (
          <>
            <Link href={`/meetings/${m.id}`}>{m.title}</Link> ·{" "}
            {formatTimeInTz(new Date(m.startTime))}
          </>
        ),
      }),
    ),
    ...openMilestones
      .filter((m) => m.dueDate !== null && m.dueDate >= today)
      .map(
        (m): LogFutureNode => ({
          key: `fms-${m.id}`,
          kind: "milestone",
          sortDate: parseDateStr(m.dueDate!),
          dateLabel: `Upcoming · ${formatShortDateStr(m.dueDate!)}`,
          title: (
            <Link href={`/projects/${project.id}?tab=milestones`}>
              Milestone: {m.name}
            </Link>
          ),
        }),
      ),
  ];

  const tabHref = (t: Tab) =>
    t === "overview" ? `/projects/${project.id}` : `/projects/${project.id}?tab=${t}`;
  const tabLabel: Record<Tab, string> = {
    overview: "Overview",
    tasks: "Tasks",
    milestones: "Milestones",
    meetings: "Meetings",
    notes: "Notes",
    links: "Links",
    files: "Files & Links",
  };
  const tabCount: Record<Tab, number | null> = {
    overview: null,
    tasks: openItems.length,
    milestones: openMilestones.length,
    meetings: meetings.length,
    notes: notes.length,
    links: links.length,
    // Drive is the source of truth — no count without a live API call.
    files: null,
  };

  return (
    <div className="page project-hub-page">
      <div className="detail-back">
        <Link href="/projects">‹ Back to Projects</Link>
      </div>
      <ProjectHeader
        project={{
          id: project.id,
          name: project.name,
          description: project.description,
          deadline: project.deadline,
          status: project.status,
        }}
        openTaskCount={openItems.length}
        overdueTaskCount={overdueCount}
        doneTaskCount={doneItems.length}
        nextMeetingLabel={nextMeeting?.title ?? null}
      />

      <nav className="hub-tabs" aria-label="Project sections">
        {visibleTabs.map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            className={`hub-tab ${tab === t ? "on" : ""}`}
            aria-current={tab === t ? "page" : undefined}
          >
            {tabLabel[t]}
            {tabCount[t] !== null && <span className="hub-tab-n">{tabCount[t]}</span>}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <ProjectTimeline project={project} milestones={milestones} today={today} />
      )}
      {tab === "overview" && (
        <div className="hub-overview-grid">
          <div className="hub-overview-col">
            <section className="hub-card">
              {nextMeeting ? (
                <>
                  <span className="dash-hero-when">
                    Up next · {formatTimeInTz(new Date(nextMeeting.startTime))}
                  </span>
                  <Link
                    href={`/meetings/${nextMeeting.id}`}
                    className="hub-next-title"
                  >
                    {nextMeeting.title}
                  </Link>
                  <p className="muted">
                    {formatPrettyDate(new Date(nextMeeting.startTime))}
                    {dueBeforeNext > 0 && (
                      <>
                        {" · "}
                        {dueBeforeNext} open task{dueBeforeNext === 1 ? " is" : "s are"}{" "}
                        due by then
                      </>
                    )}
                  </p>
                </>
              ) : (
                <>
                  <span className="dash-hero-when">Up next</span>
                  <p className="muted">No upcoming meetings tagged.</p>
                </>
              )}
            </section>

            <section className="hub-card">
              <div className="hub-card-head">
                <h2>Notes</h2>
                {notes.length > 0 && <span className="count">{notes.length}</span>}
                <NewNoteButton projectId={project.id} className="ghost-btn ghost-btn-sm" />
              </div>
              {notes.length === 0 ? (
                <p className="muted empty-sm">No notes yet.</p>
              ) : (
                <>
                  <ul className="hub-due-list">
                    {notes.slice(0, 5).map((n) => (
                      <li key={n.id} className="hub-due-row">
                        <Link href={`/notes/${n.id}`} className="hub-due-content hub-note-link">
                          {n.title || "Untitled"}
                        </Link>
                        <span className="hub-due-date">
                          {formatLogDate(n.updatedAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {notes.length > 5 && (
                    <Link href={tabHref("notes")} className="hub-more-link">
                      View all {notes.length} notes →
                    </Link>
                  )}
                </>
              )}
            </section>

            <section className="hub-card">
              <div className="hub-card-head">
                <h2>Due this week</h2>
                {dueSoon.length > 0 && <span className="count">{dueSoon.length}</span>}
              </div>
              {dueSoon.length === 0 ? (
                <p className="muted empty-sm">Nothing due in the next 7 days.</p>
              ) : (
                <ul className="hub-due-list">
                  {dueSoon.map((it) => (
                    <li key={it.id} className="hub-due-row">
                      <span className="hub-due-content">{it.content}</span>
                      <span
                        className={`hub-due-date ${it.dueDate! < today ? "overdue" : ""}`}
                      >
                        {formatShortDateStr(it.dueDate!)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

          </div>

          <div className="hub-overview-col">
            <section className="hub-card">
              {filesEnabled ? (
                <FilesLinksCard
                  projectId={project.id}
                  initialLinks={links.map((l) => ({
                    id: l.id,
                    url: l.url,
                    label: l.label,
                  }))}
                />
              ) : (
                <>
                  <div className="hub-card-head">
                    <h2>Links</h2>
                    {links.length > 0 && (
                      <span className="count">{links.length}</span>
                    )}
                    <AddLinkButton projectId={project.id} />
                  </div>
                  {links.length === 0 ? (
                    <p className="muted empty-sm">No links saved yet.</p>
                  ) : (
                    <ul className="link-list">
                      {links.map((l) => {
                        const type = detectLinkType(l.url);
                        return (
                          <li key={l.id} className="link-row">
                            <a
                              href={l.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="link-anchor"
                              title={LINK_TYPE_LABEL[type]}
                            >
                              <span className="link-icon">
                                <LinkFavicon url={l.url} />
                              </span>
                              <span className="link-text">{l.label || l.url}</span>
                            </a>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              )}
            </section>

            <section className="hub-card hub-log-card">
              <div className="hub-card-head">
                <h2>Project log</h2>
              </div>
              <ProjectLog
                future={futureNodes}
                entries={logEntries}
                todayLabel={formatShortDateStr(today)}
              />
            </section>
          </div>
        </div>
      )}

      {tab === "tasks" && (
        <section className="hub-card">
          <div className="hub-card-head">
            <h2>Tasks</h2>
            <span className="count">{openItems.length}</span>
          </div>
          <ActionItemsList
            today={today}
            initialItems={openItems}
            variant="open"
            projects={projectOptions}
            defaultProjectId={project.id}
            groupBy="due"
            milestones={openMilestones.map((m) => ({ id: m.id, name: m.name }))}
          />
          {doneItems.length > 0 && (
            <details className="hub-collapsible">
              <summary>Show {doneItems.length} completed</summary>
              <ActionItemsList today={today} initialItems={doneItems} variant="done" />
            </details>
          )}
        </section>
      )}

      {tab === "milestones" && (
        <section className="hub-card">
          <div className="hub-card-head">
            <h2>Milestones</h2>
            {openMilestones.length > 0 && (
              <span className="count">{openMilestones.length}</span>
            )}
          </div>
          <ProjectMilestones
            projectId={project.id}
            today={today}
            initial={milestones.map((m) => ({
              id: m.id,
              name: m.name,
              dueDate: m.dueDate,
              completed: m.completedAt !== null,
              total: m.totalTaskCount,
              done: m.doneTaskCount,
            }))}
          />
        </section>
      )}

      {tab === "meetings" && (
        <section className="hub-card">
          <div className="hub-card-head">
            <h2>Meetings</h2>
            <span className="count">{meetings.length}</span>
          </div>
          {meetings.length === 0 ? (
            <p className="muted empty-sm">No meetings tagged yet.</p>
          ) : (
            <>
              {upcomingMeetings.length > 0 && (
                <div className="hub-meetings-group">
                  {pastMeetings.length > 0 && (
                    <div className="hub-meetings-group-label">Upcoming</div>
                  )}
                  <MeetingList meetings={upcomingMeetings} />
                </div>
              )}
              {pastMeetings.length > 0 && (
                <div className="hub-meetings-group">
                  {upcomingMeetings.length > 0 && (
                    <div className="hub-meetings-group-label">Past</div>
                  )}
                  <MeetingList meetings={pastMeetings} />
                </div>
              )}
            </>
          )}
        </section>
      )}

      {tab === "notes" && (
        <section className="hub-card">
          <div className="hub-card-head">
            <h2>Notes</h2>
            <NewNoteButton projectId={project.id} className="ghost-btn" />
          </div>
          {notes.length === 0 ? (
            <p className="muted empty-sm">No notes yet.</p>
          ) : (
            <ul className="notes-index notes-index-embedded">
              {notes.map((n) => (
                <li key={n.id}>
                  <Link href={`/notes/${n.id}`} className="note-row">
                    <span className="note-row-title">{n.title || "Untitled"}</span>
                    <span className="note-row-meta">
                      <span className="note-row-updated">
                        Updated {formatUpdatedShort(n.updatedAt)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "links" && (
        <section className="hub-card">
          <div className="hub-card-head">
            <h2>Links</h2>
          </div>
          <ProjectLinks
            projectId={project.id}
            initialLinks={links.map((l) => ({ id: l.id, url: l.url, label: l.label }))}
          />
        </section>
      )}

      {tab === "files" && filesEnabled && (
        <section className="hub-card">
          <div className="hub-card-head">
            <h2>Files &amp; Links</h2>
          </div>
          <FileBrowser projectId={project.id} />
        </section>
      )}
    </div>
  );
}
