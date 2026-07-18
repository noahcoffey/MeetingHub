"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearDraft,
  readDraft,
  shouldOfferRestore,
  writeDraft,
  type NotesDraft as Draft,
} from "@/lib/notes-draft";
import { MarkdownEditor, type MarkdownEditorHandle } from "./markdown-editor";
import { MarkdownHelp } from "./markdown-help";
import { useSaveReport, type SaveState } from "../../save-status";

type Status = SaveState;

const SAVE_DEBOUNCE_MS = 800;
const RETRY_MS = 5000;

// Autosaving, offline-safe markdown notes. Generic over the save endpoint + draft
// key so both meetings and the journal can use it.
export function NotesEditor({
  noteKey,
  saveUrl,
  initialNotes,
  initialNotesUpdatedAt,
  onAddActionItem,
  reportKey = "notes",
}: {
  noteKey: string;
  saveUrl: string;
  initialNotes: string;
  initialNotesUpdatedAt: string;
  onAddActionItem: (text: string) => void;
  reportKey?: string;
}) {
  const [status, setStatus] = useState<Status>("saved");
  const report = useSaveReport();

  // Report this editor's status into the shared (single) save indicator.
  useEffect(() => {
    report(reportKey, status);
  }, [status, report, reportKey]);
  useEffect(() => () => report(reportKey, "saved"), [report, reportKey]);
  const [restoreDraft, setRestoreDraft] = useState<Draft | null>(null);
  const [serverNotes, setServerNotes] = useState<string | null>(null); // for conflict

  // Mutable refs so timers/listeners always see the latest values.
  const notesRef = useRef(initialNotes);
  const baseRef = useRef(initialNotesUpdatedAt);
  const savedNotesRef = useRef(initialNotes); // last value server confirmed
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const editorRef = useRef<MarkdownEditorHandle>(null);

  const persistLocal = useCallback(
    (value: string) => {
      writeDraft(noteKey, {
        notes: value,
        clientUpdatedAt: Date.now(),
        base: baseRef.current,
      });
    },
    [noteKey],
  );

  // The core save. Returns nothing; updates status + refs.
  const save = useCallback(async () => {
    if (savingRef.current) return;
    const toSave = notesRef.current;
    if (toSave === savedNotesRef.current) {
      setStatus("saved");
      return;
    }
    savingRef.current = true;
    setStatus("saving");
    try {
      const res = await fetch(saveUrl, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notes: toSave, baseNotesUpdatedAt: baseRef.current }),
      });

      if (res.status === 409) {
        const data = (await res.json()) as {
          notes: string;
          notesUpdatedAt: string;
        };
        setServerNotes(data.notes);
        baseRef.current = data.notesUpdatedAt; // so "keep mine" can overwrite
        setStatus("conflict");
        return;
      }
      if (!res.ok) {
        setStatus("error");
        return;
      }

      const data = (await res.json()) as { notesUpdatedAt: string };
      baseRef.current = data.notesUpdatedAt;
      savedNotesRef.current = toSave;

      // If nothing changed since we started saving, we're clean — drop the draft.
      if (notesRef.current === toSave) {
        clearDraft(noteKey);
        setStatus("saved");
      } else {
        // More edits arrived mid-save; persist + save again.
        persistLocal(notesRef.current);
        setStatus("dirty");
        scheduleSave(0);
      }
    } catch {
      // Network failure / offline. Draft is already in localStorage — safe.
      setStatus("offline");
      scheduleSave(RETRY_MS);
    } finally {
      savingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveUrl, noteKey, persistLocal]);

  const scheduleSave = useCallback(
    (delay: number) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void save();
      }, delay);
    },
    [save],
  );

  // On mount: decide whether to offer a local draft restore.
  useEffect(() => {
    const draft = readDraft(noteKey);
    if (!draft) return;
    if (shouldOfferRestore(draft, initialNotes, initialNotesUpdatedAt)) {
      // Local copy is newer than the server — let the user choose.
      setRestoreDraft(draft);
    } else if (draft.notes === savedNotesRef.current) {
      // Draft matches server; nothing to restore.
      clearDraft(noteKey);
    }
    // else: server is newer — keep draft around but don't auto-apply.
  }, [noteKey, initialNotes, initialNotesUpdatedAt]);

  // Flush pending writes when the connection comes back or the tab refocuses.
  useEffect(() => {
    function onBackOnline() {
      if (notesRef.current !== savedNotesRef.current) scheduleSave(0);
    }
    window.addEventListener("online", onBackOnline);
    window.addEventListener("focus", onBackOnline);
    return () => {
      window.removeEventListener("online", onBackOnline);
      window.removeEventListener("focus", onBackOnline);
    };
  }, [scheduleSave]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Called on every editor edit with the current markdown.
  function handleEditorChange(markdown: string) {
    notesRef.current = markdown;
    persistLocal(markdown); // synchronous safety net on every change
    setStatus("dirty");
    scheduleSave(SAVE_DEBOUNCE_MS);
  }

  function applyRestore() {
    if (!restoreDraft) return;
    editorRef.current?.setMarkdown(restoreDraft.notes);
    notesRef.current = restoreDraft.notes;
    setRestoreDraft(null);
    setStatus("dirty");
    scheduleSave(0);
  }

  function discardRestore() {
    clearDraft(noteKey);
    setRestoreDraft(null);
  }

  // Conflict resolution
  function keepMine() {
    setServerNotes(null);
    setStatus("dirty");
    scheduleSave(0); // baseRef was set to server's, so this overwrites
  }

  function useTheirs() {
    if (serverNotes === null) return;
    editorRef.current?.setMarkdown(serverNotes);
    notesRef.current = serverNotes;
    savedNotesRef.current = serverNotes;
    setServerNotes(null);
    clearDraft(noteKey);
    setStatus("saved");
  }

  return (
    <div className="notes-editor">
      {restoreDraft && (
        <div className="banner restore-banner">
          <span>You have a newer local draft that wasn’t saved to the server.</span>
          <div className="banner-actions">
            <button type="button" className="primary-btn" onClick={applyRestore}>
              Restore local draft
            </button>
            <button type="button" className="ghost-btn" onClick={discardRestore}>
              Discard
            </button>
          </div>
        </div>
      )}

      {serverNotes !== null && (
        <div className="banner conflict-banner">
          <span>
            These notes were changed on another device. Keep your version or load
            the other one?
          </span>
          <div className="banner-actions">
            <button type="button" className="primary-btn" onClick={keepMine}>
              Keep mine
            </button>
            <button type="button" className="ghost-btn" onClick={useTheirs}>
              Use the other version
            </button>
          </div>
        </div>
      )}

      <div className="notes-surface">
        <MarkdownEditor
          ref={editorRef}
          initialMarkdown={initialNotes}
          onChange={handleEditorChange}
          onAddActionItem={onAddActionItem}
        />
      </div>

      <MarkdownHelp />
    </div>
  );
}
