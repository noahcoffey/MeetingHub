import Link from "next/link";
import { redirect } from "next/navigation";
import { getMeetingsForDate, getMeetingsInRange } from "@/lib/meetings";
import { listOpenActionItems } from "@/lib/action-items";
import { listProjects } from "@/lib/projects";
import { getHideGeneratedNotes } from "@/lib/app-settings";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { isFeatureEnabled } from "@/lib/workspaces";
import {
  formatDateLabel,
  formatDateInTz,
  formatMonthLabel,
  formatTimeInTz,
  isValidDateParam,
  shiftDate,
  shiftMonth,
  todayInAppTz,
  APP_TIMEZONE,
} from "@/lib/dates";
import { DateNav } from "../date-nav";
import { NewMeetingForm } from "../new-meeting-form";
import { ImportCalendarButton } from "../import-calendar-button";
import { MeetingList } from "../meeting-list";
import { DayTasks, type DayTask } from "../day-tasks";
import { MarkdownView } from "./[id]/markdown-view";

export const dynamic = "force-dynamic";

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const params = await searchParams;
  const date = isValidDateParam(params.date) ? params.date : todayInAppTz();
  const isNotes = params.view === "notes";
  // "day" pins the schedule view (the toggle + day nav use it); a bare
  // /meetings (no view) is "auto" and may fall through to month below.
  const explicitDay = params.view === "day";
  let isMonth = params.view === "month";
  const workspace = await getActiveWorkspace();
  if (!isFeatureEnabled(workspace, "meetings")) redirect("/");
  const calendarEnabled = isFeatureEnabled(workspace, "calendar");
  const workspaceId = workspace.id;
  const [openItems, projects, hideGenerated] = await Promise.all([
    listOpenActionItems(workspaceId),
    listProjects(workspaceId),
    getHideGeneratedNotes(),
  ]);
  let meetings: Awaited<ReturnType<typeof getMeetingsForDate>> = [];
  if (!isMonth) {
    meetings = await getMeetingsForDate(workspaceId, date);
    // Auto mode with an empty day → month view, so sparse workspaces (a
    // a club that meets twice a month) land somewhere useful by default.
    if (!explicitDay && !isNotes && meetings.length === 0) isMonth = true;
  }
  // Month view: the whole calendar month containing `date`, grouped by day.
  const monthStart = shiftMonth(date, 0);
  const monthEnd = shiftDate(shiftMonth(date, 1), -1);
  const monthMeetings = isMonth
    ? await getMeetingsInRange(workspaceId, monthStart, monthEnd)
    : [];
  const today = todayInAppTz();
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  const dayTasks: DayTask[] = openItems.map((it) => ({
    id: it.id,
    content: it.content,
    dueDate: it.dueDate,
    createdDay: formatDateInTz(new Date(it.createdAt), APP_TIMEZONE),
    meetingId: it.meetingId,
  }));

  // Schedule/Month/Notes toggle hrefs (preserve the viewed date). Schedule is
  // the explicit view=day so it can show an empty day without auto-bouncing.
  const dq = date === today ? "" : `date=${date}`;
  const scheduleHref = dq ? `/meetings?${dq}&view=day` : "/meetings?view=day";
  const notesHref = dq ? `/meetings?${dq}&view=notes` : "/meetings?view=notes";
  const monthHref = dq ? `/meetings?${dq}&view=month` : "/meetings?view=month";

  const noted = meetings.filter((m) => m.notes.trim().length > 0);

  // Month rows grouped into per-day sections, chronological.
  const monthDays: { day: string; items: typeof monthMeetings }[] = [];
  for (const m of monthMeetings) {
    const day = formatDateInTz(new Date(m.startTime), APP_TIMEZONE);
    const last = monthDays[monthDays.length - 1];
    if (last && last.day === day) last.items.push(m);
    else monthDays.push({ day, items: [m] });
  }

  return (
    <div className="page">
      <div className="day-toolbar">
        <div className="day-toolbar-id">
          <h1 className="page-title">
            {isMonth
              ? formatMonthLabel(date)
              : date === today
                ? "Today"
                : formatDateLabel(date)}
          </h1>
          {isMonth ? (
            <p className="muted page-subtitle">
              {monthMeetings.length === 1
                ? "1 meeting"
                : `${monthMeetings.length} meetings`}
            </p>
          ) : (
            date === today && (
              <p className="muted page-subtitle">{formatDateLabel(date)}</p>
            )
          )}
        </div>

        <div className="day-toolbar-controls">
          <div className="range-toggle view-toggle">
            <Link
              href={scheduleHref}
              className={`range-btn ${!isNotes && !isMonth ? "is-active" : ""}`}
            >
              Schedule
            </Link>
            <Link
              href={monthHref}
              className={`range-btn ${isMonth ? "is-active" : ""}`}
            >
              Month
            </Link>
            <Link
              href={notesHref}
              className={`range-btn ${isNotes ? "is-active" : ""}`}
            >
              Notes
            </Link>
          </div>

          <div className="head-controls">
            {calendarEnabled && <ImportCalendarButton date={date} />}
            <DateNav
              date={date}
              basePath="/meetings"
              unit={isMonth ? "month" : "day"}
              query={
                isNotes
                  ? { view: "notes" }
                  : isMonth
                    ? { view: "month" }
                    : { view: "day" }
              }
            />
          </div>

          <NewMeetingForm defaultDate={date} />
        </div>
      </div>

      {isMonth ? (
        monthDays.length === 0 ? (
          <p className="muted empty">
            No meetings in {formatMonthLabel(date)}.
          </p>
        ) : (
          <div className="month-list">
            {monthDays.map((g) => (
              <section
                key={g.day}
                className={`month-day ${g.day === today ? "is-today" : ""}`}
              >
                <Link
                  href={`/meetings?date=${g.day}&view=day`}
                  className="month-day-head"
                >
                  {g.day === today ? "Today" : formatDateLabel(g.day)}
                </Link>
                <ul className="month-day-items">
                  {g.items.map((m) => (
                    <li key={m.id}>
                      <Link href={`/meetings/${m.id}`} className="month-row">
                        <span className="month-row-time">
                          {formatTimeInTz(new Date(m.startTime))}
                        </span>
                        <span className="month-row-main">
                          <span className="month-row-title">{m.title}</span>
                          {!hideGenerated && m.hasGenerated ? (
                            <span className="badge badge-notes-plus">
                              Notes+
                            </span>
                          ) : (
                            m.hasNotes && <span className="badge">Notes</span>
                          )}
                          {m.projectId &&
                            projectNameById.get(m.projectId) && (
                              <span className="badge badge-project">
                                {projectNameById.get(m.projectId)}
                              </span>
                            )}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )
      ) : isNotes ? (
        noted.length === 0 ? (
          <p className="muted empty">No notes for this day.</p>
        ) : (
          <div className="day-notes">
            {noted.map((m) => (
              <section className="day-notes-item" key={m.id}>
                <div className="day-notes-head">
                  <div className="day-notes-titles">
                    <h2 className="day-notes-title">{m.title}</h2>
                    <span className="day-notes-time">
                      {formatTimeInTz(new Date(m.startTime))}
                    </span>
                  </div>
                  <Link href={`/meetings/${m.id}`} className="row-action">
                    View meeting →
                  </Link>
                </div>
                <MarkdownView markdown={m.notes} />
              </section>
            ))}
          </div>
        )
      ) : (
        <>
          <MeetingList
            initial={meetings.map((m) => ({
              id: m.id,
              title: m.title,
              time: formatTimeInTz(new Date(m.startTime)),
              source: m.source,
              hasNotes: m.notes.trim().length > 0,
              hasGenerated:
                !hideGenerated && (m.notesGenerated ?? "").trim().length > 0,
              projectName: m.projectId ? (projectNameById.get(m.projectId) ?? null) : null,
            }))}
          />

          <DayTasks date={date} items={dayTasks} />
        </>
      )}
    </div>
  );
}
