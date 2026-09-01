"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { NotesEditor } from "./notes-editor";
import { GeneratedNotesEditor } from "./generated-notes";
import { MoveNotesPicker } from "../../move-notes-picker";
import type { SaveState } from "../../save-status";
import { useAddActionItem } from "../../use-add-action-item";

const SPLIT_KEY = "mh:notes-split";
const SPLIT_DEFAULT = 0.5;
const SPLIT_MIN = 0.15;
const SPLIT_MAX = 0.85;

function clampSplit(f: number): number {
  return Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, f));
}

// Drag-resizable split between two stacked sections: the fraction of the
// container height given to the first section. Persisted globally, so the
// split carries across meetings.
function useResizableSplit(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [split, setSplitState] = useState(SPLIT_DEFAULT);
  const [dragging, setDragging] = useState(false);

  // Read persisted split after mount (avoids SSR/hydration mismatch).
  useEffect(() => {
    const f = Number(localStorage.getItem(SPLIT_KEY));
    if (Number.isFinite(f) && f > 0) setSplitState(clampSplit(f));
  }, []);

  function setSplit(f: number, opts?: { persist?: boolean }) {
    const clamped = clampSplit(f);
    setSplitState(clamped);
    if (opts?.persist) {
      try {
        localStorage.setItem(SPLIT_KEY, String(clamped));
      } catch {
        /* ignore */
      }
    }
  }

  function onDividerPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    const height = containerRef.current?.getBoundingClientRect().height;
    if (!height) return;
    const startY = e.clientY;
    const startSplit = split;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      setSplit(startSplit + (ev.clientY - startY) / height);
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      setDragging(false);
      setSplit(startSplit + (ev.clientY - startY) / height, { persist: true });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function onDividerKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowUp") setSplit(split - 0.05, { persist: true });
    else if (e.key === "ArrowDown") setSplit(split + 0.05, { persist: true });
    else return;
    e.preventDefault();
  }

  function resetSplit() {
    setSplit(SPLIT_DEFAULT, { persist: true });
  }

  return { split, dragging, onDividerPointerDown, onDividerKeyDown, resetSplit };
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`rail-chevron ${open ? "open" : ""}`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      aria-hidden
    >
      <path
        d="M7 5l5 5-5 5"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Two stacked, collapsible sections in the notes column: Notes over Generated
// notes. Both open → drag-resizable split (persisted, shared across meetings);
// one collapsed → the open one fills; collapsed sits snug as a header bar.
// Editors stay mounted when collapsed (state preserved).
export function NotesStack({
  meetingId,
  date,
  initialNotes,
  initialNotesUpdatedAt,
  generated,
  highlight,
}: {
  meetingId: string;
  // The meeting's own day (app tz, YYYY-MM-DD) — seeds the move picker.
  date: string;
  initialNotes: string;
  initialNotesUpdatedAt: string;
  generated: string | null;
  highlight?: string;
}) {
  const router = useRouter();
  const hasGenerated = generated !== null;

  // When arriving from search, auto-expand a section whose content matches.
  const terms = (highlight?.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 2,
  );
  const matches = (text: string | null) =>
    !!text && terms.some((t) => text.toLowerCase().includes(t));

  const [notesOpen, setNotesOpen] = useState(true);
  const [genOpen, setGenOpen] = useState(hasGenerated && matches(generated));
  // "Move…" on the Generated header: the recorder sometimes files Notes+ under
  // the wrong meeting. The picker won't fire while an autosave is pending, or
  // the debounced PATCH could land the edited body back on this meeting.
  const [moving, setMoving] = useState(false);
  const [genState, setGenState] = useState<SaveState>("saved");
  // True from the move POST until navigation (or failure); the editor is
  // locked meanwhile so nothing typed can fall between the two meetings.
  const [moveBusy, setMoveBusy] = useState(false);
  const addActionItem = useAddActionItem({ meetingId });

  const stackRef = useRef<HTMLDivElement>(null);
  const { split, dragging, onDividerPointerDown, onDividerKeyDown, resetSplit } =
    useResizableSplit(stackRef);

  // The proportional split only applies while both sections are open; with one
  // collapsed the open section fills via the base CSS.
  const bothOpen = hasGenerated && notesOpen && genOpen;

  return (
    <div className="notes-stack" ref={stackRef}>
      <section
        id="nsec-notes"
        className={`nsec ${notesOpen ? "open" : "collapsed"}`}
        style={bothOpen ? { flexGrow: split } : undefined}
      >
        <button
          type="button"
          className="nsec-head"
          onClick={() => setNotesOpen((o) => !o)}
          aria-expanded={notesOpen}
        >
          <div className="notes-col nsec-head-inner">
            <Chevron open={notesOpen} />
            <span>Notes</span>
          </div>
        </button>
        <div className="nsec-body">
          <div className="notes-col">
            <NotesEditor
              noteKey={meetingId}
              saveUrl={`/api/meetings/${meetingId}`}
              initialNotes={initialNotes}
              initialNotesUpdatedAt={initialNotesUpdatedAt}
              onAddActionItem={addActionItem}
            />
          </div>
        </div>
      </section>

      {bothOpen && (
        <div
          className={`nsec-resize ${dragging ? "dragging" : ""}`}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize notes split"
          aria-controls="nsec-notes"
          aria-valuemin={Math.round(SPLIT_MIN * 100)}
          aria-valuemax={Math.round(SPLIT_MAX * 100)}
          aria-valuenow={Math.round(split * 100)}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={onDividerPointerDown}
          onDoubleClick={resetSplit}
          onKeyDown={onDividerKeyDown}
        />
      )}

      {hasGenerated && (
        <section
          className={`nsec ${genOpen ? "open" : "collapsed"}`}
          style={bothOpen ? { flexGrow: 1 - split } : undefined}
        >
          <div className="nsec-head-row">
            <button
              type="button"
              className="nsec-head"
              onClick={() => setGenOpen((o) => !o)}
              aria-expanded={genOpen}
            >
              <div className="notes-col nsec-head-inner">
                <Chevron open={genOpen} />
                <span>Generated notes</span>
              </div>
            </button>
            <button
              type="button"
              className="ghost-btn nsec-head-action"
              aria-expanded={moving}
              title="Move these generated notes to another meeting"
              onClick={() => {
                const next = !moving;
                setMoving(next);
                if (next) setGenOpen(true);
              }}
            >
              Move…
            </button>
          </div>
          <div className="nsec-body">
            <div className="notes-col">
              {moving && (
                <MoveNotesPicker
                  sourceMeetingId={meetingId}
                  initialDate={date}
                  disabled={genState !== "saved"}
                  onBusyChange={setMoveBusy}
                  onMoved={(targetId) => router.push(`/meetings/${targetId}`)}
                />
              )}
              <GeneratedNotesEditor
                meetingId={meetingId}
                initial={generated}
                onStateChange={setGenState}
                locked={moveBusy}
              />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
