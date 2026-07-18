import Link from "next/link";
import { redirect } from "next/navigation";
import { listPeopleWithSchedule, type PersonListEntry } from "@/lib/people";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { isFeatureEnabled } from "@/lib/workspaces";
import {
  APP_TIMEZONE,
  formatDateInTz,
  formatTimeInTz,
  shiftDate,
  todayInAppTz,
} from "@/lib/dates";
import { NewPersonForm } from "./new-person-form";

export const dynamic = "force-dynamic";

const QUIET_AFTER_DAYS = 30;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "?";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

// "Jun 30", plus the year once it isn't this year's.
function shortDate(d: Date, todayStr: string): string {
  const sameYear =
    formatDateInTz(d, APP_TIMEZONE).slice(0, 4) === todayStr.slice(0, 4);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  }).format(d);
}

// Row label for the next 1:1: time-of-day today, "Tomorrow", else "Thu Jul 17".
function whenLabel(next: Date, todayStr: string): string {
  const day = formatDateInTz(next, APP_TIMEZONE);
  if (day === todayStr) return formatTimeInTz(next);
  if (day === shiftDate(todayStr, 1)) return "Tomorrow";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(next);
}

function Avatar({ person }: { person: PersonListEntry }) {
  // No email = title-linked only (e.g. a recurring forum) — muted treatment.
  return (
    <span
      className={`people-avatar${person.email ? "" : " people-avatar-forum"}`}
      aria-hidden="true"
    >
      {initials(person.name)}
    </span>
  );
}

function CountChips({ person }: { person: PersonListEntry }) {
  return (
    <>
      {person.openAgendaCount > 0 && (
        <span
          className="note-chip"
          title={`${person.openAgendaCount} open agenda item${person.openAgendaCount === 1 ? "" : "s"}`}
        >
          {person.openAgendaCount}
        </span>
      )}
      {person.waitingOnCount > 0 && (
        <span
          className="note-chip note-chip-warn"
          title={`waiting on ${person.waitingOnCount} item${person.waitingOnCount === 1 ? "" : "s"}`}
        >
          {person.waitingOnCount}
        </span>
      )}
    </>
  );
}

function CadenceRow({
  person,
  todayStr,
}: {
  person: PersonListEntry;
  todayStr: string;
}) {
  const next = person.nextMeetingAt as Date; // rows only render for scheduled people
  const isToday = formatDateInTz(next, APP_TIMEZONE) === todayStr;
  return (
    <li>
      <Link href={`/people/${person.id}`} className="people-cad-row">
        <span className={`people-cad-when${isToday ? " is-today" : ""}`}>
          {whenLabel(next, todayStr)}
        </span>
        <span className="people-cad-name">{person.name}</span>
        <span className="people-cad-peek">
          {person.nextAgendaContent ? (
            <>
              <em>Raise:</em> {person.nextAgendaContent}
            </>
          ) : (
            "Nothing queued"
          )}
        </span>
        <span className="people-cad-meta">
          <CountChips person={person} />
        </span>
      </Link>
    </li>
  );
}

function PersonCard({
  person,
  todayStr,
}: {
  person: PersonListEntry;
  todayStr: string;
}) {
  const quietSince =
    person.lastMetAt &&
    person.openAgendaCount === 0 &&
    person.waitingOnCount === 0 &&
    person.lastMetAt.getTime() < Date.now() - QUIET_AFTER_DAYS * 86_400_000
      ? shortDate(person.lastMetAt, todayStr)
      : null;
  return (
    <li>
      <Link href={`/people/${person.id}`} className="people-card">
        <span className="people-card-id">
          <Avatar person={person} />
          <span className="people-card-who">
            <span className="people-card-name">{person.name}</span>
            {person.email && (
              <span className="people-card-email">{person.email}</span>
            )}
          </span>
        </span>
        <span className="people-card-chips">
          {person.openAgendaCount > 0 && (
            <span className="note-chip">
              {person.openAgendaCount} agenda item
              {person.openAgendaCount === 1 ? "" : "s"}
            </span>
          )}
          {person.waitingOnCount > 0 && (
            <span className="note-chip note-chip-warn">
              waiting on {person.waitingOnCount}
            </span>
          )}
          {quietSince && (
            <span className="note-chip note-chip-meeting">
              quiet since {quietSince}
            </span>
          )}
        </span>
        <span className="people-card-foot">
          <span>
            {person.lastMetAt
              ? `Met ${shortDate(person.lastMetAt, todayStr)}`
              : "Never met"}
          </span>
          <span>Not scheduled</span>
        </span>
      </Link>
    </li>
  );
}

function CadenceGroup({
  label,
  people,
  todayStr,
}: {
  label: string;
  people: PersonListEntry[];
  todayStr: string;
}) {
  if (people.length === 0) return null;
  return (
    <section className="people-group">
      <div className="people-group-label">
        {label} <span className="count">{people.length}</span>
      </div>
      <ul className="people-cad-list">
        {people.map((p) => (
          <CadenceRow key={p.id} person={p} todayStr={todayStr} />
        ))}
      </ul>
    </section>
  );
}

export default async function PeoplePage() {
  const workspace = await getActiveWorkspace();
  if (!isFeatureEnabled(workspace, "people")) redirect("/");
  const people = await listPeopleWithSchedule(workspace.id);
  const todayStr = todayInAppTz();

  const scheduled = people
    .filter((p) => p.nextMeetingAt !== null)
    .sort(
      (a, b) =>
        (a.nextMeetingAt as Date).getTime() - (b.nextMeetingAt as Date).getTime(),
    );
  const unscheduled = people.filter((p) => p.nextMeetingAt === null);

  const endOfWeek = shiftDate(todayStr, 6);
  const dayOf = (p: PersonListEntry) =>
    formatDateInTz(p.nextMeetingAt as Date, APP_TIMEZONE);
  const today = scheduled.filter((p) => dayOf(p) === todayStr);
  const thisWeek = scheduled.filter(
    (p) => dayOf(p) > todayStr && dayOf(p) <= endOfWeek,
  );
  const later = scheduled.filter((p) => dayOf(p) > endOfWeek);

  return (
    <div className="page">
      <div className="day-toolbar">
        <div className="day-toolbar-id">
          <h1 className="page-title">People</h1>
          <p className="muted page-subtitle">
            Upcoming 1:1s first, then everyone else.
          </p>
        </div>
        <div className="day-toolbar-controls">
          <NewPersonForm />
        </div>
      </div>

      {people.length === 0 ? (
        <p className="muted empty">
          No people yet. Add your directs and frequent 1:1s to start queueing
          agenda topics.
        </p>
      ) : (
        <>
          <CadenceGroup label="Today" people={today} todayStr={todayStr} />
          <CadenceGroup label="This week" people={thisWeek} todayStr={todayStr} />
          <CadenceGroup label="Later" people={later} todayStr={todayStr} />

          {unscheduled.length > 0 && (
            <section className="people-group people-group-cards">
              {scheduled.length > 0 && (
                <div className="people-group-label">
                  Everyone else <span className="count">{unscheduled.length}</span>
                </div>
              )}
              <ul className="people-cards">
                {unscheduled.map((p) => (
                  <PersonCard key={p.id} person={p} todayStr={todayStr} />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
