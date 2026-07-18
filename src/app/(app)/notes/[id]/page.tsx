import Link from "next/link";
import { notFound } from "next/navigation";
import { getNote, getNoteAttachments } from "@/lib/notes";
import { listOpenActionItems } from "@/lib/action-items";
import { listProjects } from "@/lib/projects";
import {
  formatPrettyDate,
  formatTimeInTz,
  formatDateInTz,
  todayInAppTz,
  APP_TIMEZONE,
} from "@/lib/dates";
import { SaveStatusProvider, SaveIndicator } from "../../save-status";
import { ActionItemsList } from "../../action-items-list";
import { toClientItem, type ClientItem } from "../../action-item-mapper";
import { RailResizeHandle, RailToggle } from "../../chrome";
import { NoteBody } from "./note-body";
import { NoteTitle } from "./note-title";
import { NotesRail } from "./notes-rail";
import { DeleteNoteButton } from "./delete-note-button";

export const dynamic = "force-dynamic";

export default async function NoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const note = await getNote(id);
  if (!note) notFound();

  // Rail content scopes by the note's own workspace (deep-link safe).
  const [attachments, open, projects] = await Promise.all([
    getNoteAttachments(id),
    listOpenActionItems(note.workspaceId),
    listProjects(note.workspaceId),
  ]);
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  const clientItems: ClientItem[] = open.map(toClientItem);

  const attachedMeetings = attachments.meetings.map((m) => {
    const s = new Date(m.startTime);
    return {
      id: m.id,
      title: m.title,
      meta: `${formatPrettyDate(s)} · ${formatTimeInTz(s)}`,
    };
  });

  return (
    <div className="meeting-workspace">
      {/* key by note so the editor remounts (resets content) when navigating between notes */}
      <SaveStatusProvider key={note.id}>
        <section className="notes-pane">
          <div className="notes-pane-head">
            <div className="notes-col">
              <div className="detail-back">
                <Link href="/notes">‹ Back to Notes</Link>
                <DeleteNoteButton noteId={note.id} />
              </div>
              <header className="detail-header">
                <div className="detail-title-row">
                  <NoteTitle noteId={note.id} initialTitle={note.title} />
                  <SaveIndicator />
                </div>
              </header>
            </div>
          </div>
          <div className="notes-stack">
            <section className="nsec open note-nsec">
              <div className="nsec-body">
                <div className="notes-col">
                  <NoteBody
                    noteId={note.id}
                    initialNotes={note.notes}
                    initialNotesUpdatedAt={new Date(
                      note.notesUpdatedAt,
                    ).toISOString()}
                  />
                </div>
              </div>
            </section>
          </div>
        </section>

        <aside className="actions-rail">
          <RailResizeHandle />
          <RailToggle />
          <NotesRail
            noteId={note.id}
            initialProjects={attachments.projects}
            initialMeetings={attachedMeetings}
            allProjects={projectOptions}
          >
            <ActionItemsList
              today={todayInAppTz()}
              initialItems={clientItems}
              projects={projectOptions}
            />
          </NotesRail>
        </aside>
      </SaveStatusProvider>
    </div>
  );
}
