import Link from "next/link";
import { getDashboardData, type TrendDirection } from "@/lib/dashboard";
import { listOpenActionItems } from "@/lib/action-items";
import { listProjects } from "@/lib/projects";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { isFeatureEnabled } from "@/lib/workspaces";
import {
  APP_TIMEZONE,
  formatDateInTz,
  formatDateLabel,
  formatPrettyDateStr,
  formatTimeInTz,
  todayInAppTz,
} from "@/lib/dates";
import { SaveStatusProvider, SaveIndicator } from "./save-status";
import { JournalNotes } from "./journal/journal-notes";
import { MetaChart } from "./reports/meta-chart";
import { DashboardAutoRefresh } from "./dashboard-auto-refresh";
import { ActionItemsList } from "./action-items-list";
import { toClientItem, type ClientItem } from "./action-item-mapper";
import { RailResizeHandle, RailToggle } from "./chrome";

export const dynamic = "force-dynamic";

function TrendArrow({ direction }: { direction: TrendDirection }) {
  const glyph = direction === "up" ? "↑" : direction === "down" ? "↓" : "→";
  return (
    <span className="trend-arrow" aria-label={`Trend: ${direction}`}>
      {glyph}
    </span>
  );
}

export default async function DashboardPage() {
  const workspace = await getActiveWorkspace();
  const workspaceId = workspace.id;
  const projectsEnabled = isFeatureEnabled(workspace, "projects");
  const [data, open, projects] = await Promise.all([
    getDashboardData(workspace),
    listOpenActionItems(workspaceId),
    projectsEnabled ? listProjects(workspaceId) : Promise.resolve([]),
  ]);
  const today = todayInAppTz();
  const meetingsLeft = data.meetingsTotal - data.meetingsDone;
  const meetingsPct =
    data.meetingsTotal > 0
      ? Math.round((data.meetingsDone / data.meetingsTotal) * 100)
      : 0;

  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  const clientItems: ClientItem[] = open.map(toClientItem);

  return (
    <div className="meeting-workspace">
      <div className="dash-pane">
        <div className="page">
          <DashboardAutoRefresh />
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="muted page-subtitle">{formatDateLabel(today)}</p>
        </div>
      </div>

      <div className="dash-strip">
        {data.features.journal &&
          data.statCards.map((c) => (
            <Link key={c.id} href="/reports" className="dash-tile">
              <span className="dash-tile-label">{c.name}</span>
              <div className="dash-tile-row">
                <span className="dash-tile-stat">
                  <span className="dash-tile-num">
                    {c.avg == null
                      ? "–"
                      : c.isBoolean
                        ? `${Math.round(c.avg * 100)}%`
                        : c.avg.toFixed(1)}
                  </span>
                  {c.avg != null && !c.isBoolean && (
                    <span className="dash-tile-denom">
                      {c.unit ? c.unit : `/${c.max}`}
                    </span>
                  )}
                  <TrendArrow direction={c.trend} />
                </span>
                <div className="dash-tile-spark">
                  <MetaChart
                    days={c.points}
                    avg={c.avg}
                    tone={c.tone}
                    min={c.min}
                    max={c.max}
                    unit={c.unit}
                  />
                </div>
              </div>
            </Link>
          ))}

        <Link href="/tasks" className="dash-tile">
          <span className="dash-tile-label">Open tasks</span>
          <div className="dash-tile-row">
            <span className="dash-tile-stat">
              <span className="dash-tile-num">{data.tasks.open}</span>
            </span>
          </div>
          <span className="dash-tile-sub">
            {data.tasks.dueToday} due today
            {data.tasks.overdue > 0 && (
              <>
                {" · "}
                <span className="dash-tile-bad">{data.tasks.overdue} overdue</span>
              </>
            )}
          </span>
        </Link>

        {data.features.projects && (
          <Link href="/projects" className="dash-tile">
            <span className="dash-tile-label">Projects</span>
            <div className="dash-tile-row">
              <span className="dash-tile-stat">
                <span className="dash-tile-num">{data.projects.activeCount}</span>
              </span>
            </div>
            <span className="dash-tile-sub">
              {data.projects.nextCheckpoint
                ? data.projects.nextCheckpoint.milestoneName
                  ? `${data.projects.nextCheckpoint.projectName}: ${data.projects.nextCheckpoint.milestoneName} due ${formatPrettyDateStr(data.projects.nextCheckpoint.date)}`
                  : `${data.projects.nextCheckpoint.projectName} due ${formatPrettyDateStr(data.projects.nextCheckpoint.date)}`
                : data.projects.activeCount === 1
                  ? "active project"
                  : "active projects"}
            </span>
          </Link>
        )}
      </div>

      {data.features.meetings && (
      <section className="dash-hero">
        {data.currentMeeting ? (
          <div className="dash-hero-main">
            <span className="dash-hero-when">In progress</span>
            <Link
              href={`/meetings/${data.currentMeeting.id}`}
              className="dash-hero-title"
            >
              {data.currentMeeting.title}
            </Link>
            {data.nextMeeting && (
              <p className="muted dash-hero-time">
                Next: {data.nextMeeting.title} ·{" "}
                {formatTimeInTz(new Date(data.nextMeeting.startTime))}
              </p>
            )}
          </div>
        ) : data.nextMeeting ? (
          <div className="dash-hero-main">
            <span className="dash-hero-when">
              Up next · {formatTimeInTz(new Date(data.nextMeeting.startTime))}
            </span>
            <Link
              href={`/meetings/${data.nextMeeting.id}`}
              className="dash-hero-title"
            >
              {data.nextMeeting.title}
            </Link>
            <p className="muted dash-hero-time">
              {formatPrettyDateStr(today)} ·{" "}
              <Link
                href={`/meetings/${data.nextMeeting.id}`}
                className="row-action"
              >
                Prep →
              </Link>
            </p>
          </div>
        ) : (
          <div className="dash-hero-main">
            <span className="dash-hero-when">Today</span>
            <p className="dash-hero-empty muted">
              {data.meetingsTotal === 0
                ? "No meetings today."
                : "No more meetings today."}
            </p>
          </div>
        )}
        {data.meetingsTotal > 0 && (
          <div className="dash-hero-prog">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${meetingsPct}%` }} />
            </div>
            <p className="muted dash-progress-label">
              {data.meetingsDone} done · {meetingsLeft} left today
            </p>
          </div>
        )}
      </section>
      )}

      <div className="dash-bottom-grid">
        {data.features.journal && data.journalEntry && (
        <section className="dash-card dash-yesterday">
          <SaveStatusProvider>
            <div className="dash-card-head dash-yesterday-head">
              <span>
                {data.journalEntry.entryDate === today
                  ? "Today’s journal"
                  : "Yesterday’s journal"}
                <span className="dash-card-sub">
                  {formatPrettyDateStr(data.journalEntry.entryDate)}
                </span>
              </span>
              <SaveIndicator />
            </div>
            <div className="dash-scroll dash-yesterday-notes">
              <JournalNotes
                entryId={data.journalEntry.id}
                initialNotes={data.journalEntry.notes}
                initialNotesUpdatedAt={data.journalEntry.notesUpdatedAt}
              />
            </div>
          </SaveStatusProvider>
          <Link
            href={`/journal?date=${data.journalEntry.entryDate}`}
            className="row-action"
          >
            Open in Journal →
          </Link>
        </section>
        )}

        {data.features.journal && (
        <section className="dash-card dash-week-digest">
          <h2 className="day-tasks-title">This week&rsquo;s reflections</h2>
          {data.weekDigest.length === 0 ? (
            <p className="muted">No reflections logged yet this week.</p>
          ) : (
            <ul className="digest-list">
              {data.weekDigest.map((e) => (
                <li className="digest-item" key={e.date}>
                  <div className="digest-date">
                    {formatPrettyDateStr(e.date)}
                  </div>
                  {e.items.map((it, i) => (
                    <div className="digest-block" key={i}>
                      <span className="digest-tag">{it.name}</span>
                      <p>{it.text}</p>
                    </div>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
        )}
      </div>
        </div>
      </div>

      <aside className="actions-rail">
        <RailResizeHandle />
        <RailToggle />
        <div className="rail-sections">
          <section className="rail-section open weight-1">
            <div className="rail-section-head">Action items</div>
            <div className="rail-section-body">
              <ActionItemsList
                today={today}
                initialItems={clientItems}
                projects={projectOptions}
              />
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}
