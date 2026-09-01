"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MoveNotesPicker } from "./move-notes-picker";

export type SkippedNotesRow = {
  id: string;
  title: string;
  time: string;
  // The day the skipped meeting sits on — seeds the move picker's date input.
  date: string;
};

// Ingest can land generated notes on a meeting that was already skipped, where
// nothing in the day view would ever show them. This sits under the day's list
// and offers the two ways out: restore the occurrence, or move the notes to
// the meeting they actually belong to.
export function SkippedNotesBanner({ initial }: { initial: SkippedNotesRow[] }) {
  const [rows, setRows] = useState(initial);
  if (rows.length === 0) return null;
  return (
    <section className="skipped-notes">
      {rows.map((row) => (
        <SkippedNotesItem
          key={row.id}
          row={row}
          onDone={(id) => setRows((r) => r.filter((x) => x.id !== id))}
        />
      ))}
    </section>
  );
}

function SkippedNotesItem({
  row,
  onDone,
}: {
  row: SkippedNotesRow;
  onDone: (id: string) => void;
}) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);

  async function restore() {
    onDone(row.id);
    try {
      await fetch(`/api/meetings/${row.id}/skip`, { method: "DELETE" });
    } finally {
      router.refresh();
    }
  }

  return (
    <div className="skipped-notes-row">
      <p className="skipped-notes-text">
        Skipped meeting <strong>{row.title}</strong>{" "}
        <span className="skipped-when">{row.time}</span> has{" "}
        <span className="badge badge-notes-plus">Notes+</span>. Restore it, or
        move the notes to another meeting.
      </p>
      <div className="skipped-notes-actions">
        <button type="button" className="ghost-btn" onClick={restore}>
          Restore
        </button>
        <button
          type="button"
          className="ghost-btn"
          aria-expanded={moving}
          onClick={() => setMoving((m) => !m)}
        >
          Move…
        </button>
      </div>
      {moving && (
        <MoveNotesPicker
          sourceMeetingId={row.id}
          initialDate={row.date}
          onMoved={() => {
            onDone(row.id);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
