// Pure, framework-free logic for the offline notes-draft safety net.
// Kept out of the React component so the "never lose notes" rules are unit-testable.

export type NotesDraft = {
  notes: string;
  clientUpdatedAt: number; // epoch ms of last local edit
  base: string; // the notesUpdatedAt (ISO) this draft was edited from
};

export function draftKey(meetingId: string): string {
  return `mh:notes:${meetingId}`;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window !== "undefined" && window.localStorage) {
    return window.localStorage;
  }
  return null;
}

export function readDraft(
  meetingId: string,
  storage?: StorageLike,
): NotesDraft | null {
  const s = resolveStorage(storage);
  if (!s) return null;
  try {
    const raw = s.getItem(draftKey(meetingId));
    if (!raw) return null;
    const d = JSON.parse(raw) as NotesDraft;
    if (typeof d.notes !== "string" || typeof d.clientUpdatedAt !== "number") {
      return null;
    }
    return d;
  } catch {
    return null;
  }
}

export function writeDraft(
  meetingId: string,
  draft: NotesDraft,
  storage?: StorageLike,
): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.setItem(draftKey(meetingId), JSON.stringify(draft));
  } catch {
    // Storage full/disabled — in-memory state still holds the notes.
  }
}

export function clearDraft(meetingId: string, storage?: StorageLike): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    s.removeItem(draftKey(meetingId));
  } catch {
    /* ignore */
  }
}

// Should we prompt the user to restore a local draft over the server copy?
// Only when the local draft differs from the server AND was edited more recently
// than the server's last save (i.e. unsaved local work that would otherwise be lost).
export function shouldOfferRestore(
  draft: NotesDraft | null,
  serverNotes: string,
  serverNotesUpdatedAtIso: string,
): boolean {
  if (!draft) return false;
  if (draft.notes === serverNotes) return false;
  const serverMs = Date.parse(serverNotesUpdatedAtIso);
  if (Number.isNaN(serverMs)) return true; // can't compare — safer to offer
  return draft.clientUpdatedAt > serverMs;
}
