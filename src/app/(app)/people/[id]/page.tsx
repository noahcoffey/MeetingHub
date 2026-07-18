import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPerson,
  listLinkedTitles,
  listMeetingsForPerson,
  listOpenAgendaItems,
  listDiscussedAgendaItems,
} from "@/lib/people";
import { formatPrettyDate, formatTimeInTz, formatDateInTz, APP_TIMEZONE, todayInAppTz } from "@/lib/dates";
import { listOpenActionItemsWaitingOn } from "@/lib/action-items";
import { listProjects } from "@/lib/projects";
import type { Meeting } from "@/db/schema";
import { PersonHeader } from "./person-header";
import { LinkedTitlesManager } from "./linked-titles-manager";
import { AgendaList } from "../agenda-list";
import { ActionItemsList } from "../../action-items-list";
import { toClientItem } from "../../action-item-mapper";

export const dynamic = "force-dynamic";

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

export default async function PersonDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const person = await getPerson(id);
  if (!person) notFound();

  const [meetings, titles, agendaOpen, agendaDone, waiting, projects] =
    await Promise.all([
      listMeetingsForPerson(id),
      listLinkedTitles(id),
      listOpenAgendaItems(id),
      listDiscussedAgendaItems(id),
      listOpenActionItemsWaitingOn(id),
      listProjects(person.workspaceId),
    ]);
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  const now = new Date();
  const upcoming = meetings
    .filter((m) => new Date(m.startTime) >= now)
    .sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  const past = meetings.filter((m) => new Date(m.startTime) < now);

  return (
    <div className="page person-page">
      <div className="detail-back">
        <Link href="/people">‹ Back to People</Link>
      </div>
      <PersonHeader
        person={{ id: person.id, name: person.name, email: person.email }}
      />

      <div className="person-grid">
        <div className="person-col">
        <section className="hub-card">
          <div className="hub-card-head">
            <h2>Agenda</h2>
            {agendaOpen.length > 0 && (
              <span className="count">{agendaOpen.length}</span>
            )}
          </div>
          <p className="muted settings-desc">
            Things to raise at the next meeting. They&rsquo;ll surface in the
            meeting&rsquo;s rail too.
          </p>
          <AgendaList
            people={[{ id: person.id, name: person.name }]}
            initialItems={agendaOpen.map((it) => ({
              id: it.id,
              personId: it.personId,
              content: it.content,
            }))}
            discussedMeetingId={null}
          />
          {agendaDone.length > 0 && (
            <details className="hub-collapsible">
              <summary>Show {agendaDone.length} discussed</summary>
              <ul className="agenda-history">
                {agendaDone.map((it) => (
                  <li key={it.id} className="agenda-history-row">
                    <span className="agenda-history-content">{it.content}</span>
                    <span className="agenda-history-meta">
                      {it.discussedAt &&
                        formatDateInTz(new Date(it.discussedAt), APP_TIMEZONE)}
                      {it.discussedMeetingId && it.meetingTitle && (
                        <>
                          {" · "}
                          <Link href={`/meetings/${it.discussedMeetingId}`}>
                            {it.meetingTitle}
                          </Link>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section className="hub-card">
          <div className="hub-card-head">
            <h2>Meetings</h2>
            {meetings.length > 0 && <span className="count">{meetings.length}</span>}
          </div>
          {meetings.length === 0 ? (
            <p className="muted empty-sm">
              No meetings matched yet. Add an email or link a meeting title below.
            </p>
          ) : (
            <>
              {upcoming.length > 0 && (
                <div className="hub-meetings-group">
                  {past.length > 0 && (
                    <div className="hub-meetings-group-label">Upcoming</div>
                  )}
                  <MeetingList meetings={upcoming} />
                </div>
              )}
              {past.length > 0 && (
                <div className="hub-meetings-group">
                  {upcoming.length > 0 && (
                    <div className="hub-meetings-group-label">Past</div>
                  )}
                  <MeetingList meetings={past} />
                </div>
              )}
            </>
          )}
        </section>
        </div>

        <div className="person-col">
        <section className="hub-card">
          <div className="hub-card-head">
            <h2>Waiting on {person.name.split(" ")[0]}</h2>
            {waiting.length > 0 && <span className="count">{waiting.length}</span>}
          </div>
          <p className="muted settings-desc">
            Open tasks delegated to them. New tasks added here are tagged
            automatically.
          </p>
          <ActionItemsList
            today={todayInAppTz()}
            initialItems={waiting.map(toClientItem)}
            groupBy="due"
            projects={projectOptions}
            people={[{ id: person.id, name: person.name }]}
            defaultWaitingOnPersonId={person.id}
          />
        </section>

        <section className="hub-card">
          <div className="hub-card-head">
            <h2>Linked meeting titles</h2>
          </div>
          <p className="muted settings-desc">
            Meetings with these exact titles belong to {person.name}, in addition
            to any meeting whose attendees include their email.
          </p>
          <LinkedTitlesManager
            personId={person.id}
            initial={titles.map((t) => ({ id: t.id, title: t.title }))}
          />
        </section>
        </div>
      </div>
    </div>
  );
}
