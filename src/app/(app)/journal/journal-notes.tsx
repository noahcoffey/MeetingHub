"use client";

import { NotesEditor } from "../meetings/[id]/notes-editor";
import { useAddActionItem } from "../use-add-action-item";

// Journal notes reuse the meeting NotesEditor (autosave + offline draft + selection
// toolbar), pointed at the journal-entries endpoint and linking action items to the entry.
export function JournalNotes({
  entryId,
  initialNotes,
  initialNotesUpdatedAt,
}: {
  entryId: string;
  initialNotes: string;
  initialNotesUpdatedAt: string;
}) {
  const addActionItem = useAddActionItem({ journalEntryId: entryId });
  return (
    <NotesEditor
      noteKey={`journal-${entryId}`}
      saveUrl={`/api/journal-entries/${entryId}`}
      initialNotes={initialNotes}
      initialNotesUpdatedAt={initialNotesUpdatedAt}
      onAddActionItem={addActionItem}
    />
  );
}
