"use client";

import { NotesEditor } from "../../meetings/[id]/notes-editor";
import { useAddActionItem } from "../../use-add-action-item";

// Note bodies reuse the meeting NotesEditor (autosave + offline draft + selection
// toolbar), pointed at the notes endpoint. Action items created from a note are
// standalone (action_items has no note FK).
export function NoteBody({
  noteId,
  initialNotes,
  initialNotesUpdatedAt,
}: {
  noteId: string;
  initialNotes: string;
  initialNotesUpdatedAt: string;
}) {
  const addActionItem = useAddActionItem({});
  return (
    <NotesEditor
      noteKey={`note-${noteId}`}
      saveUrl={`/api/notes/${noteId}`}
      initialNotes={initialNotes}
      initialNotesUpdatedAt={initialNotesUpdatedAt}
      onAddActionItem={addActionItem}
    />
  );
}
