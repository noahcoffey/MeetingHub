import "server-only";
import { and, asc, count, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  people,
  personMeetingTitles,
  agendaItems,
  actionItems,
  meetings,
  type Person,
  type PersonMeetingTitle,
  type AgendaItem,
  type Meeting,
} from "@/db/schema";

// ---- people CRUD ----

export type PersonSummary = Person & {
  openAgendaCount: number;
  waitingOnCount: number;
};

export async function listPeople(workspaceId: string): Promise<PersonSummary[]> {
  const all = await db
    .select()
    .from(people)
    .where(eq(people.workspaceId, workspaceId))
    .orderBy(asc(people.name));
  if (all.length === 0) return [];

  const [agendaCounts, waitingCounts] = await Promise.all([
    db
      .select({ personId: agendaItems.personId, n: count() })
      .from(agendaItems)
      .where(isNull(agendaItems.discussedAt))
      .groupBy(agendaItems.personId),
    db
      .select({ personId: actionItems.waitingOnPersonId, n: count() })
      .from(actionItems)
      .where(eq(actionItems.status, "open"))
      .groupBy(actionItems.waitingOnPersonId),
  ]);
  const agendaByPerson = new Map(agendaCounts.map((r) => [r.personId, r.n]));
  const waitingByPerson = new Map(
    waitingCounts.filter((r) => r.personId).map((r) => [r.personId, r.n]),
  );

  return all.map((p) => ({
    ...p,
    openAgendaCount: agendaByPerson.get(p.id) ?? 0,
    waitingOnCount: waitingByPerson.get(p.id) ?? 0,
  }));
}

// People index enriched with 1:1 cadence: when we last met, the next matched
// meeting on the calendar, and the top queued agenda item. Matching mirrors
// listMeetingsForPerson (attendee email OR exact linked title) but aggregates
// per person in one query so the page stays a fixed number of round-trips.
export type PersonListEntry = PersonSummary & {
  lastMetAt: Date | null;
  nextMeetingAt: Date | null;
  nextAgendaContent: string | null;
};

export async function listPeopleWithSchedule(
  workspaceId: string,
): Promise<PersonListEntry[]> {
  const base = await listPeople(workspaceId);
  if (base.length === 0) return [];

  const [scheduleRows, firstAgendaRows] = await Promise.all([
    db.execute(sql`
      SELECT p.id,
             max(m.start_time) FILTER (WHERE m.start_time < now()) AS last_met,
             min(m.start_time) FILTER (WHERE m.start_time >= now()) AS next_meeting
      FROM people p
      JOIN meetings m
        ON m.skipped = false
       AND m.workspace_id = ${workspaceId}
       AND (
             (p.email IS NOT NULL AND EXISTS (
               SELECT 1 FROM jsonb_array_elements(m.attendees) a
               WHERE lower(a->>'email') = p.email
             ))
             OR EXISTS (
               SELECT 1 FROM person_meeting_titles t
               WHERE t.person_id = p.id AND t.title = m.title
             )
           )
      WHERE p.workspace_id = ${workspaceId}
      GROUP BY p.id
    `) as unknown as Promise<
      Array<{ id: string; last_met: string | Date | null; next_meeting: string | Date | null }>
    >,
    db
      .selectDistinctOn([agendaItems.personId], {
        personId: agendaItems.personId,
        content: agendaItems.content,
      })
      .from(agendaItems)
      .where(isNull(agendaItems.discussedAt))
      .orderBy(asc(agendaItems.personId), asc(agendaItems.createdAt)),
  ]);

  const scheduleByPerson = new Map(scheduleRows.map((r) => [r.id, r]));
  const firstAgendaByPerson = new Map(
    firstAgendaRows.map((r) => [r.personId, r.content]),
  );

  return base.map((p) => {
    const s = scheduleByPerson.get(p.id);
    return {
      ...p,
      lastMetAt: s?.last_met ? new Date(s.last_met) : null,
      nextMeetingAt: s?.next_meeting ? new Date(s.next_meeting) : null,
      nextAgendaContent: firstAgendaByPerson.get(p.id) ?? null,
    };
  });
}

// Light variant for pickers (no counts).
export async function listPeopleNames(
  workspaceId: string,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(eq(people.workspaceId, workspaceId))
    .orderBy(asc(people.name));
}

export async function getPerson(id: string): Promise<Person | undefined> {
  const [p] = await db.select().from(people).where(eq(people.id, id)).limit(1);
  return p;
}

// Note: never create a person with the user's own email — it would match
// every imported meeting. Single-user tool, so no code guard.
export async function createPerson(
  workspaceId: string,
  input: {
    name: string;
    email?: string | null;
  },
): Promise<Person> {
  const [p] = await db
    .insert(people)
    .values({
      workspaceId,
      name: input.name,
      email: input.email ? input.email.trim().toLowerCase() : null,
    })
    .returning();
  return p;
}

export async function updatePerson(
  id: string,
  patch: { name?: string; email?: string | null },
): Promise<Person | undefined> {
  const set: Partial<typeof people.$inferInsert> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.email !== undefined) {
    set.email = patch.email ? patch.email.trim().toLowerCase() : null;
  }
  const [p] = await db.update(people).set(set).where(eq(people.id, id)).returning();
  return p;
}

export async function deletePerson(id: string): Promise<void> {
  // Titles + agenda items cascade; waiting-on tasks detach (set null).
  await db.delete(people).where(eq(people.id, id));
}

// ---- linked meeting titles ----

export async function listLinkedTitles(
  personId: string,
): Promise<PersonMeetingTitle[]> {
  return db
    .select()
    .from(personMeetingTitles)
    .where(eq(personMeetingTitles.personId, personId))
    .orderBy(asc(personMeetingTitles.title));
}

export async function addLinkedTitle(
  personId: string,
  title: string,
): Promise<void> {
  await db
    .insert(personMeetingTitles)
    .values({ personId, title })
    .onConflictDoNothing();
}

export async function removeLinkedTitle(id: string): Promise<void> {
  await db.delete(personMeetingTitles).where(eq(personMeetingTitles.id, id));
}

// ---- matching (read-time only; see schema comment) ----

// All meetings that belong to a person: exact linked-title match OR the
// person's email appears in the attendees jsonb.
export async function listMeetingsForPerson(personId: string): Promise<Meeting[]> {
  const person = await getPerson(personId);
  if (!person) return [];
  const titles = (await listLinkedTitles(personId)).map((t) => t.title);

  const conditions: SQL[] = [];
  if (titles.length > 0) conditions.push(inArray(meetings.title, titles));
  if (person.email) {
    conditions.push(
      sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${meetings.attendees}) a
        WHERE lower(a->>'email') = ${person.email}
      )`,
    );
  }
  if (conditions.length === 0) return [];

  return db
    .select()
    .from(meetings)
    .where(
      and(
        eq(meetings.workspaceId, person.workspaceId),
        eq(meetings.skipped, false),
        or(...conditions),
      ),
    )
    .orderBy(desc(meetings.startTime))
    .limit(50);
}

// Which people does this meeting belong to? Two tiny queries + JS filter —
// fine at single-user scale.
export async function matchPeopleForMeeting(
  meeting: Pick<Meeting, "workspaceId" | "title" | "attendees">,
): Promise<Person[]> {
  const [all, links] = await Promise.all([
    db
      .select()
      .from(people)
      .where(eq(people.workspaceId, meeting.workspaceId))
      .orderBy(asc(people.name)),
    db.select().from(personMeetingTitles),
  ]);
  if (all.length === 0) return [];

  const titlesByPerson = new Map<string, Set<string>>();
  for (const l of links) {
    const set = titlesByPerson.get(l.personId) ?? new Set();
    set.add(l.title);
    titlesByPerson.set(l.personId, set);
  }
  const attendeeEmails = new Set(
    meeting.attendees
      .map((a) => a.email?.toLowerCase())
      .filter((e): e is string => !!e),
  );

  return all.filter(
    (p) =>
      (p.email !== null && attendeeEmails.has(p.email)) ||
      titlesByPerson.get(p.id)?.has(meeting.title),
  );
}

// The meeting rail's one-shot fetch: who does this meeting belong to, and
// what's queued up for them.
export async function getAgendaForMeeting(
  meeting: Pick<Meeting, "workspaceId" | "title" | "attendees">,
): Promise<{ people: Person[]; items: AgendaItem[] }> {
  const matched = await matchPeopleForMeeting(meeting);
  if (matched.length === 0) return { people: [], items: [] };
  const items = await listOpenAgendaItemsForPeople(matched.map((p) => p.id));
  return { people: matched, items };
}

// ---- agenda queue ----

export async function listOpenAgendaItems(personId: string): Promise<AgendaItem[]> {
  return db
    .select()
    .from(agendaItems)
    .where(and(eq(agendaItems.personId, personId), isNull(agendaItems.discussedAt)))
    .orderBy(asc(agendaItems.createdAt));
}

export async function listOpenAgendaItemsForPeople(
  personIds: string[],
): Promise<AgendaItem[]> {
  if (personIds.length === 0) return [];
  return db
    .select()
    .from(agendaItems)
    .where(
      and(inArray(agendaItems.personId, personIds), isNull(agendaItems.discussedAt)),
    )
    .orderBy(asc(agendaItems.createdAt));
}

export type DiscussedAgendaItem = AgendaItem & {
  meetingTitle: string | null;
  meetingStart: Date | null;
};

export async function listDiscussedAgendaItems(
  personId: string,
): Promise<DiscussedAgendaItem[]> {
  const rows = await db
    .select({
      item: agendaItems,
      meetingTitle: meetings.title,
      meetingStart: meetings.startTime,
    })
    .from(agendaItems)
    .leftJoin(meetings, eq(agendaItems.discussedMeetingId, meetings.id))
    .where(
      and(eq(agendaItems.personId, personId), sql`${agendaItems.discussedAt} IS NOT NULL`),
    )
    .orderBy(desc(agendaItems.discussedAt))
    .limit(50);
  return rows.map((r) => ({
    ...r.item,
    meetingTitle: r.meetingTitle,
    meetingStart: r.meetingStart,
  }));
}

export async function createAgendaItem(
  personId: string,
  content: string,
): Promise<AgendaItem> {
  const [item] = await db
    .insert(agendaItems)
    .values({ personId, content })
    .returning();
  return item;
}

export async function updateAgendaItem(
  id: string,
  patch: {
    content?: string;
    // Object = mark discussed now (optionally in a meeting); null = reopen.
    discussed?: { meetingId: string | null } | null;
  },
): Promise<AgendaItem | undefined> {
  const set: Partial<typeof agendaItems.$inferInsert> = { updatedAt: new Date() };
  if (patch.content !== undefined) set.content = patch.content;
  if (patch.discussed !== undefined) {
    if (patch.discussed === null) {
      set.discussedAt = null;
      set.discussedMeetingId = null;
    } else {
      set.discussedAt = new Date();
      set.discussedMeetingId = patch.discussed.meetingId;
    }
  }
  const [item] = await db
    .update(agendaItems)
    .set(set)
    .where(eq(agendaItems.id, id))
    .returning();
  return item;
}

export async function deleteAgendaItem(id: string): Promise<void> {
  await db.delete(agendaItems).where(eq(agendaItems.id, id));
}
