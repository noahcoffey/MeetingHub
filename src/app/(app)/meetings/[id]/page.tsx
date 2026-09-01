import Link from "next/link";
import { notFound } from "next/navigation";
import { getMeeting, listPastMeetingsByTitle } from "@/lib/meetings";
import { listOpenActionItems, listOpenItemsFromSeries } from "@/lib/action-items";
import { listProjects, suggestProjectFor } from "@/lib/projects";
import { listNotesForMeeting } from "@/lib/notes";
import { getAgendaForMeeting, listPeopleNames } from "@/lib/people";
import { AgendaList } from "../../people/agenda-list";
import { toClientItem, type ClientItem } from "../../action-item-mapper";
import {
  formatTimeInTz,
  formatDateInTz,
  formatPrettyDate,
  formatPrettyDateStr,
  todayInAppTz,
  APP_TIMEZONE,
} from "@/lib/dates";
import { cleanDescription } from "@/lib/clean-description";
import { getHideGeneratedNotes } from "@/lib/app-settings";
import { SaveStatusProvider, SaveIndicator } from "../../save-status";
import { NotesStack } from "./notes-stack";
import { SearchHighlighter } from "./search-highlighter";
import { DeleteMeetingButton } from "./delete-meeting-button";
import { PastMeetings, type PastItem } from "./past-meetings";
import { ActionItemsList } from "../../action-items-list";
import { MeetingRail } from "./meeting-rail";
import { RailResizeHandle, RailToggle } from "../../chrome";
import { MeetingProjectPicker } from "./meeting-project-picker";
import { MeetingTitle } from "./meeting-title";
import { RelatedProjectsRail } from "./related-projects-rail";
import { listRelationsForProject } from "@/lib/project-relations";
import { getWorkspaceById, isFeatureEnabled } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export default async function MeetingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { id } = await params;
  const { q } = await searchParams;
  const meeting = await getMeeting(id);
  if (!meeting) notFound();

  // Everything contextual scopes by the meeting's own workspace (not the active
  // cookie) so a deep link into another workspace never mixes content.
  const workspaceId = meeting.workspaceId;

  // The rail shows ALL open items (grouped); not just this meeting's.
  const [
    open,
    projects,
    suggestedProject,
    hideGenerated,
    attachedNotes,
    agenda,
    peopleOptions,
    seriesItems,
    workspace,
    relations,
  ] = await Promise.all([
    listOpenActionItems(workspaceId),
    listProjects(workspaceId),
    meeting.projectId ? null : suggestProjectFor(workspaceId, meeting.title),
    getHideGeneratedNotes(),
    listNotesForMeeting(id),
    getAgendaForMeeting(meeting),
    listPeopleNames(workspaceId),
    listOpenItemsFromSeries(workspaceId, meeting.title, meeting.id),
    getWorkspaceById(workspaceId),
    meeting.projectId ? listRelationsForProject(meeting.projectId) : [],
  ]);
  const projectsEnabled = workspace ? isFeatureEnabled(workspace, "projects") : false;
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  const clientItems: ClientItem[] = open.map(toClientItem);

  const start = new Date(meeting.startTime);
  const end = meeting.endTime ? new Date(meeting.endTime) : null;
  const dateStr = formatDateInTz(start, APP_TIMEZONE);

  // Earlier occurrences of this same-titled meeting (the "Past meetings" tab).
  const past = await listPastMeetingsByTitle(
    workspaceId,
    meeting.title,
    meeting.id,
    start,
  );
  const pastItems: PastItem[] = past.map((m) => {
    const s = new Date(m.startTime);
    return {
      id: m.id,
      dateLabel: formatPrettyDateStr(formatDateInTz(s, APP_TIMEZONE)),
      timeLabel: formatTimeInTz(s),
      hasNotes: m.notes.trim().length > 0,
      hasGenerated: !hideGenerated && (m.notesGenerated ?? "").trim().length > 0,
    };
  });

  return (
    <div className="meeting-workspace">
      {q ? <SearchHighlighter query={q} /> : null}
      <section className="notes-pane">
        <SaveStatusProvider>
          <div className="notes-pane-head">
            <div className="notes-col">
              <div className="detail-back">
                <Link href={`/meetings?date=${dateStr}`}>‹ Back to {dateStr}</Link>
                {meeting.source === "manual" && (
                  <DeleteMeetingButton meetingId={meeting.id} backDate={dateStr} />
                )}
              </div>
              <header className="detail-header">
                <div className="detail-title-row">
                  <h1 className="page-title meeting-title-heading">
                    <MeetingTitle
                      meetingId={meeting.id}
                      initialTitle={meeting.title}
                    />
                  </h1>
                  <div className="detail-title-actions">
                    <MeetingProjectPicker
                      meetingId={meeting.id}
                      initialProjectId={meeting.projectId}
                      projects={projectOptions}
                      suggested={suggestedProject}
                    />
                    <PastMeetings
                      title={meeting.title}
                      items={pastItems}
                      hideGenerated={hideGenerated}
                    />
                    <SaveIndicator />
                  </div>
                </div>
                <p className="muted">
                  {formatPrettyDate(start)} · {formatTimeInTz(start)}
                  {end ? ` – ${formatTimeInTz(end)}` : ""}
                </p>
                {meeting.attendees.length > 0 && (
                  <p className="muted attendees">
                    {meeting.attendees
                      .map((a) => a.name || a.email)
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
              </header>
            </div>
          </div>
          <NotesStack
            meetingId={meeting.id}
            date={dateStr}
            initialNotes={meeting.notes}
            initialNotesUpdatedAt={new Date(meeting.notesUpdatedAt).toISOString()}
            generated={hideGenerated ? null : meeting.notesGenerated}
            highlight={q}
          />
        </SaveStatusProvider>
      </section>

      <aside className="actions-rail">
        <RailResizeHandle />
        <RailToggle />
        <MeetingRail
          description={cleanDescription(meeting.description)}
          meetingId={meeting.id}
          notes={attachedNotes.map((n) => ({ id: n.id, title: n.title }))}
          fromLastTime={seriesItems.map((it) => ({
            id: it.id,
            content: it.content,
            dateLabel: `from ${new Intl.DateTimeFormat("en-US", {
              timeZone: APP_TIMEZONE,
              month: "short",
              day: "numeric",
            }).format(new Date(it.meetingStart))}`,
          }))}
          relatedCount={relations.length}
          relatedProjects={
            projectsEnabled ? (
              <RelatedProjectsRail
                projectId={meeting.projectId}
                meetingId={meeting.id}
                initial={relations.map((r) => ({
                  id: r.id,
                  kind: r.kind,
                  direction: r.direction,
                  otherId: r.otherId,
                  otherName: r.otherName,
                  otherStatus: r.otherStatus,
                }))}
              />
            ) : null
          }
          agendaCount={agenda.items.length}
          agenda={
            agenda.people.length > 0 ? (
              <AgendaList
                people={agenda.people.map((p) => ({ id: p.id, name: p.name }))}
                initialItems={agenda.items.map((it) => ({
                  id: it.id,
                  personId: it.personId,
                  content: it.content,
                }))}
                discussedMeetingId={meeting.id}
              />
            ) : null
          }
        >
          <ActionItemsList
            currentMeetingId={meeting.id}
            today={todayInAppTz()}
            initialItems={clientItems}
            projects={projectOptions}
            people={peopleOptions}
          />
        </MeetingRail>
      </aside>
    </div>
  );
}
