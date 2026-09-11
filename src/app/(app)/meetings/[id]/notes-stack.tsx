"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { NotesEditor } from "./notes-editor";
import { GeneratedNotesEditor } from "./generated-notes";
import { MoveNotesPicker } from "../../move-notes-picker";
import type { SaveState } from "../../save-status";
import { useAddActionItem } from "../../use-add-action-item";

type Section = "notes" | "generated";
type OpenSection = Section | null;

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
// notes. A true accordion — exactly one is open at a time and fills the column,
// so collapsing the open one opens the other rather than leaving the column
// empty. (With no generated notes there is no other section, and Notes simply
// collapses to a header bar.) Editors stay mounted when collapsed (state
// preserved).
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

  // When arriving from search, open the section whose content matches — the
  // user's own notes win a tie.
  const terms = (highlight?.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 2,
  );
  const matches = (text: string | null) =>
    !!text && terms.some((t) => text.toLowerCase().includes(t));

  const [open, setOpen] = useState<OpenSection>(
    matches(initialNotes) || !matches(generated) ? "notes" : "generated",
  );
  const toggle = (section: Section) =>
    setOpen((cur) => {
      if (cur !== section) return section;
      // Clicking the open header hands the column to the other section; with
      // nothing to hand it to, it just collapses.
      if (!hasGenerated) return null;
      return section === "notes" ? "generated" : "notes";
    });

  // "Move…" on the Generated header: the recorder sometimes files Notes+ under
  // the wrong meeting. The picker won't fire while an autosave is pending, or
  // the debounced PATCH could land the edited body back on this meeting.
  const [moving, setMoving] = useState(false);
  const [genState, setGenState] = useState<SaveState>("saved");
  // True from the move POST until navigation (or failure); the editor is
  // locked meanwhile so nothing typed can fall between the two meetings.
  const [moveBusy, setMoveBusy] = useState(false);
  const addActionItem = useAddActionItem({ meetingId });

  const notesOpen = open === "notes";
  const genOpen = open === "generated";

  return (
    <div className="notes-stack">
      <section className={`nsec ${notesOpen ? "open" : "collapsed"}`}>
        <button
          type="button"
          className="nsec-head"
          onClick={() => toggle("notes")}
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

      {hasGenerated && (
        <section className={`nsec ${genOpen ? "open" : "collapsed"}`}>
          <div className="nsec-head-row">
            <button
              type="button"
              className="nsec-head"
              onClick={() => toggle("generated")}
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
                if (next) setOpen("generated");
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
