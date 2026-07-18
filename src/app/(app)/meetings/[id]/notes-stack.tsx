"use client";

import { useState } from "react";
import { NotesEditor } from "./notes-editor";
import { GeneratedNotesEditor } from "./generated-notes";
import { useAddActionItem } from "../../use-add-action-item";

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
// notes. Both open → 50/50; one collapsed → the open one fills; collapsed sits
// snug as a header bar. Editors stay mounted when collapsed (state preserved).
export function NotesStack({
  meetingId,
  initialNotes,
  initialNotesUpdatedAt,
  generated,
  highlight,
}: {
  meetingId: string;
  initialNotes: string;
  initialNotesUpdatedAt: string;
  generated: string | null;
  highlight?: string;
}) {
  const hasGenerated = generated !== null;

  // When arriving from search, auto-expand a section whose content matches.
  const terms = (highlight?.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (t) => t.length >= 2,
  );
  const matches = (text: string | null) =>
    !!text && terms.some((t) => text.toLowerCase().includes(t));

  const [notesOpen, setNotesOpen] = useState(true);
  const [genOpen, setGenOpen] = useState(hasGenerated && matches(generated));
  const addActionItem = useAddActionItem({ meetingId });

  return (
    <div className="notes-stack">
      <section className={`nsec ${notesOpen ? "open" : "collapsed"}`}>
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

      {hasGenerated && (
        <section className={`nsec ${genOpen ? "open" : "collapsed"}`}>
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
          <div className="nsec-body">
            <div className="notes-col">
              <GeneratedNotesEditor meetingId={meetingId} initial={generated} />
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
