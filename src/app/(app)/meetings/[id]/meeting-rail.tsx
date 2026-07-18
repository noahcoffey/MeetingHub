"use client";

import { useState } from "react";
import Link from "next/link";
import { NewNoteButton } from "../../notes/new-note-button";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`rail-chevron ${open ? "open" : ""}`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      aria-hidden
    >
      <path d="M7 5l5 5-5 5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type SeriesRow = {
  id: string;
  content: string;
  // e.g. "from Jul 8" — which earlier occurrence it came out of.
  dateLabel: string;
};

// Right rail for the meeting detail: Agenda (queued topics for the matched
// people) over From-last-time (open items from earlier occurrences) over
// Action items over Notes (attached first-class notes) over Description.
// All sections collapse to just their header.
export function MeetingRail({
  description,
  meetingId,
  notes,
  agenda,
  agendaCount = 0,
  fromLastTime = [],
  children,
}: {
  description: string;
  meetingId: string;
  notes: { id: string; title: string }[];
  // Rendered agenda section body; null when no people match this meeting.
  agenda?: React.ReactNode;
  agendaCount?: number;
  // Open action items created in earlier same-title meetings.
  fromLastTime?: SeriesRow[];
  children: React.ReactNode;
}) {
  const hasDescription = description.trim().length > 0;
  const [agendaOpen, setAgendaOpen] = useState(agendaCount > 0);
  const [lastTimeOpen, setLastTimeOpen] = useState(fromLastTime.length > 0);
  const [itemsOpen, setItemsOpen] = useState(true);
  // Collapse the notes section by default when nothing is attached yet.
  const [notesOpen, setNotesOpen] = useState(notes.length > 0);
  // Collapse the description section by default when there's nothing to show.
  const [descOpen, setDescOpen] = useState(hasDescription);

  return (
    <div className="rail-sections">
      {agenda != null && (
        <section className={`rail-section ${agendaOpen ? "open" : "collapsed"}`}>
          <button
            type="button"
            className="rail-section-head"
            onClick={() => setAgendaOpen((o) => !o)}
            aria-expanded={agendaOpen}
          >
            <Chevron open={agendaOpen} />
            Agenda
          </button>
          {agendaOpen && <div className="rail-section-body">{agenda}</div>}
        </section>
      )}

      {fromLastTime.length > 0 && (
        <section
          className={`rail-section ${lastTimeOpen ? "open" : "collapsed"}`}
        >
          <button
            type="button"
            className="rail-section-head"
            onClick={() => setLastTimeOpen((o) => !o)}
            aria-expanded={lastTimeOpen}
          >
            <Chevron open={lastTimeOpen} />
            From last time
          </button>
          {lastTimeOpen && (
            <div className="rail-section-body">
              <ul className="series-items">
                {fromLastTime.map((it) => (
                  <li key={it.id} className="series-row">
                    <span className="series-content">{it.content}</span>
                    <span className="series-date">{it.dateLabel}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section
        className={`rail-section weight-2 ${itemsOpen ? "open" : "collapsed"}`}
      >
        <button
          type="button"
          className="rail-section-head"
          onClick={() => setItemsOpen((o) => !o)}
          aria-expanded={itemsOpen}
        >
          <Chevron open={itemsOpen} />
          Action items
        </button>
        {itemsOpen && <div className="rail-section-body">{children}</div>}
      </section>

      <section className={`rail-section ${notesOpen ? "open" : "collapsed"}`}>
        <button
          type="button"
          className="rail-section-head"
          onClick={() => setNotesOpen((o) => !o)}
          aria-expanded={notesOpen}
        >
          <Chevron open={notesOpen} />
          Notes
        </button>
        {notesOpen && (
          <div className="rail-section-body">
            {notes.length === 0 ? (
              <p className="muted empty-sm">No notes attached.</p>
            ) : (
              <ul className="attach-list">
                {notes.map((n) => (
                  <li key={n.id} className="attach-row">
                    <Link href={`/notes/${n.id}`} className="attach-link">
                      {n.title || "Untitled"}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <NewNoteButton meetingId={meetingId} className="ghost-btn ghost-btn-sm" />
          </div>
        )}
      </section>

      <section
        className={`rail-section weight-1 ${descOpen ? "open" : "collapsed"}`}
      >
        <button
          type="button"
          className="rail-section-head"
          onClick={() => setDescOpen((o) => !o)}
          aria-expanded={descOpen}
        >
          <Chevron open={descOpen} />
          Description
        </button>
        {descOpen && (
          <div className="rail-section-body">
            {hasDescription ? (
              <div className="desc-text">{description}</div>
            ) : (
              <p className="ai-empty">No description.</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
