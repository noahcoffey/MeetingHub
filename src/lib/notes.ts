import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { searchNotes } from "@/lib/search";
import {
  notes,
  noteProjects,
  noteMeetings,
  projects,
  meetings,
  type Note,
} from "@/db/schema";

export type SaveNotesResult =
  | { ok: true; notesUpdatedAt: Date }
  | { ok: false; conflict: true; notes: string; notesUpdatedAt: Date };

export async function getNote(id: string): Promise<Note | undefined> {
  const [n] = await db.select().from(notes).where(eq(notes.id, id)).limit(1);
  return n;
}

export async function createNote(
  workspaceId: string,
  input: {
    title?: string;
    projectId?: string;
    meetingId?: string;
  },
): Promise<Note> {
  const [n] = await db
    .insert(notes)
    .values({ workspaceId, title: input.title ?? "" })
    .returning();
  // Auto-attach only when the target lives in the same workspace; a
  // cross-workspace target is silently ignored (the note is still created).
  if (input.projectId) {
    const [p] = await db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, input.projectId))
      .limit(1);
    if (p?.workspaceId === workspaceId) {
      await db
        .insert(noteProjects)
        .values({ noteId: n.id, projectId: input.projectId });
    }
  }
  if (input.meetingId) {
    const [m] = await db
      .select({ workspaceId: meetings.workspaceId })
      .from(meetings)
      .where(eq(meetings.id, input.meetingId))
      .limit(1);
    if (m?.workspaceId === workspaceId) {
      await db
        .insert(noteMeetings)
        .values({ noteId: n.id, meetingId: input.meetingId });
    }
  }
  return n;
}

// Mirrors saveMeetingNotes/saveJournalNotes: optimistic-concurrency check
// against notes_updated_at.
export async function saveNoteBody(
  id: string,
  body: string,
  baseNotesUpdatedAt: Date | null,
): Promise<SaveNotesResult | null> {
  const current = await getNote(id);
  if (!current) return null;

  if (
    baseNotesUpdatedAt &&
    current.notesUpdatedAt.getTime() > baseNotesUpdatedAt.getTime()
  ) {
    return {
      ok: false,
      conflict: true,
      notes: current.notes,
      notesUpdatedAt: current.notesUpdatedAt,
    };
  }

  const now = new Date();
  await db
    .update(notes)
    .set({ notes: body, notesUpdatedAt: now, updatedAt: now })
    .where(eq(notes.id, id));
  return { ok: true, notesUpdatedAt: now };
}

// Bumps updatedAt only, never notesUpdatedAt — a title edit must not 409 an
// open body editor.
export async function updateNoteTitle(
  id: string,
  title: string,
): Promise<Note | undefined> {
  const [n] = await db
    .update(notes)
    .set({ title, updatedAt: new Date() })
    .where(eq(notes.id, id))
    .returning();
  return n;
}

// ---- public sharing ----

// 128 bits of randomness, base64url — unguessable, and the whole access control
// for /s/<slug>: there is no other way in and nothing else is reachable from it.
export const SHARE_SLUG_RE = /^[A-Za-z0-9_-]{22}$/;

function newShareSlug(): string {
  return randomBytes(16).toString("base64url");
}

// Flipping sharing on mints a NEW slug every time (never reuses the old one, so
// a link that was turned off stays dead); flipping it off clears the slug.
// Touches NEITHER timestamp: notesUpdatedAt would 409 an open editor, and
// updatedAt is the note's own "last edited" — bumping it would make the public
// page read "Updated today" and float the note to the top of /notes for what is
// a visibility change, not an edit. (Attach/detach behave the same way.)
export async function setNoteShared(
  id: string,
  shared: boolean,
): Promise<Note | undefined> {
  const [n] = await db
    .update(notes)
    .set(
      shared
        ? { shareSlug: newShareSlug(), sharedAt: new Date() }
        : { shareSlug: null, sharedAt: null },
    )
    .where(eq(notes.id, id))
    .returning();
  return n;
}

export type SharedNote = {
  title: string;
  notes: string;
  updatedAt: Date;
};

// The /s/<slug> page's entire query. Returns title + body and nothing else —
// no ids, no workspace, no attachments — so the public surface can't be walked
// back into the rest of the app.
export async function getSharedNote(slug: string): Promise<SharedNote | undefined> {
  if (!SHARE_SLUG_RE.test(slug)) return undefined;
  const [n] = await db
    .select({ title: notes.title, notes: notes.notes, updatedAt: notes.updatedAt })
    .from(notes)
    .where(eq(notes.shareSlug, slug))
    .limit(1);
  return n;
}

export async function deleteNote(id: string): Promise<void> {
  // note_projects/note_meetings cascade — only the attachment rows go with it.
  await db.delete(notes).where(eq(notes.id, id));
}

// ---- attachments ----

// Returns false when the note/target don't exist or live in different
// workspaces (route → 400); true on success or idempotent re-attach.
export async function attachProject(noteId: string, projectId: string): Promise<boolean> {
  const [pair] = await db
    .select({ noteWs: notes.workspaceId, targetWs: projects.workspaceId })
    .from(notes)
    .innerJoin(projects, eq(projects.id, projectId))
    .where(eq(notes.id, noteId))
    .limit(1);
  if (!pair || pair.noteWs !== pair.targetWs) return false;
  // Composite PK makes re-attach idempotent.
  await db
    .insert(noteProjects)
    .values({ noteId, projectId })
    .onConflictDoNothing();
  return true;
}

export async function detachProject(noteId: string, projectId: string): Promise<void> {
  await db
    .delete(noteProjects)
    .where(and(eq(noteProjects.noteId, noteId), eq(noteProjects.projectId, projectId)));
}

// Same cross-workspace guard as attachProject.
export async function attachMeeting(noteId: string, meetingId: string): Promise<boolean> {
  const [pair] = await db
    .select({ noteWs: notes.workspaceId, targetWs: meetings.workspaceId })
    .from(notes)
    .innerJoin(meetings, eq(meetings.id, meetingId))
    .where(eq(notes.id, noteId))
    .limit(1);
  if (!pair || pair.noteWs !== pair.targetWs) return false;
  await db
    .insert(noteMeetings)
    .values({ noteId, meetingId })
    .onConflictDoNothing();
  return true;
}

export async function detachMeeting(noteId: string, meetingId: string): Promise<void> {
  await db
    .delete(noteMeetings)
    .where(and(eq(noteMeetings.noteId, noteId), eq(noteMeetings.meetingId, meetingId)));
}

export type NoteAttachments = {
  projects: { id: string; name: string }[];
  meetings: { id: string; title: string; startTime: Date }[];
};

export async function getNoteAttachments(noteId: string): Promise<NoteAttachments> {
  const [projectRows, meetingRows] = await Promise.all([
    db
      .select({ id: projects.id, name: projects.name })
      .from(noteProjects)
      .innerJoin(projects, eq(noteProjects.projectId, projects.id))
      .where(eq(noteProjects.noteId, noteId))
      .orderBy(projects.name),
    db
      .select({ id: meetings.id, title: meetings.title, startTime: meetings.startTime })
      .from(noteMeetings)
      .innerJoin(meetings, eq(noteMeetings.meetingId, meetings.id))
      .where(eq(noteMeetings.noteId, noteId))
      .orderBy(desc(meetings.startTime)),
  ]);
  return { projects: projectRows, meetings: meetingRows };
}

// ---- lists ----

export type NoteListItem = {
  id: string;
  title: string;
  updatedAt: Date;
};

export type ProjectNoteListItem = NoteListItem & { body: string };

export async function listNotesForProject(
  projectId: string,
): Promise<ProjectNoteListItem[]> {
  return db
    .select({
      id: notes.id,
      title: notes.title,
      updatedAt: notes.updatedAt,
      body: notes.notes,
    })
    .from(noteProjects)
    .innerJoin(notes, eq(noteProjects.noteId, notes.id))
    .where(eq(noteProjects.projectId, projectId))
    .orderBy(desc(notes.updatedAt));
}

export async function listNotesForMeeting(meetingId: string): Promise<NoteListItem[]> {
  return db
    .select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt })
    .from(noteMeetings)
    .innerJoin(notes, eq(noteMeetings.noteId, notes.id))
    .where(eq(noteMeetings.meetingId, meetingId))
    .orderBy(desc(notes.updatedAt));
}

export type NoteSummary = {
  id: string;
  title: string;
  updatedAt: Date;
  shared: boolean;
  projects: { id: string; name: string }[];
  meetingCount: number;
};

// All notes with their attached project names + meeting count — the /notes list
// page's data. Grouped queries, not N+1.
export async function listNotesWithAttachments(
  workspaceId: string,
): Promise<NoteSummary[]> {
  const all = await db
    .select({ id: notes.id, title: notes.title, updatedAt: notes.updatedAt })
    .from(notes)
    .where(eq(notes.workspaceId, workspaceId))
    .orderBy(desc(notes.updatedAt));
  return hydrateAttachments(all);
}

// The /notes search box: rank-ordered hits from lib/search, hydrated into the
// same summary shape the list renders.
export async function searchNoteSummaries(
  workspaceId: string,
  query: string,
): Promise<NoteSummary[]> {
  const hits = await searchNotes(workspaceId, query);
  return hydrateAttachments(hits);
}

// Preserves the input order (recency for the list, rank for search).
async function hydrateAttachments(
  all: { id: string; title: string; updatedAt: Date }[],
): Promise<NoteSummary[]> {
  if (all.length === 0) return [];

  const ids = all.map((n) => n.id);
  const [projectRows, meetingRows, shareRows] = await Promise.all([
    db
      .select({
        noteId: noteProjects.noteId,
        id: projects.id,
        name: projects.name,
      })
      .from(noteProjects)
      .innerJoin(projects, eq(noteProjects.projectId, projects.id))
      .where(inArray(noteProjects.noteId, ids))
      .orderBy(projects.name),
    db
      .select({ noteId: noteMeetings.noteId })
      .from(noteMeetings)
      .where(inArray(noteMeetings.noteId, ids)),
    // Search hits arrive without the column, so read it here for both callers.
    db
      .select({ id: notes.id, shareSlug: notes.shareSlug })
      .from(notes)
      .where(inArray(notes.id, ids)),
  ]);
  const sharedIds = new Set(
    shareRows.filter((r) => r.shareSlug !== null).map((r) => r.id),
  );

  const projectsByNote = new Map<string, { id: string; name: string }[]>();
  for (const row of projectRows) {
    const list = projectsByNote.get(row.noteId) ?? [];
    list.push({ id: row.id, name: row.name });
    projectsByNote.set(row.noteId, list);
  }
  const meetingCountByNote = new Map<string, number>();
  for (const row of meetingRows) {
    meetingCountByNote.set(row.noteId, (meetingCountByNote.get(row.noteId) ?? 0) + 1);
  }

  return all.map((n) => ({
    ...n,
    shared: sharedIds.has(n.id),
    projects: projectsByNote.get(n.id) ?? [],
    meetingCount: meetingCountByNote.get(n.id) ?? 0,
  }));
}
