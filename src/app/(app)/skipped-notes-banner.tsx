"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
  const [date, setDate] = useState(row.date);
  const [meetings, setMeetings] = useState<{ id: string; label: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMeetings(d: string) {
    setLoading(true);
    setSelected("");
    try {
      const res = await fetch(`/api/meetings?date=${d}`);
      const data = await res.json();
      setMeetings(
        (data.meetings ?? []).map(
          (m: { id: string; title: string; startTime: string }) => ({
            id: m.id,
            label: `${new Date(m.startTime).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })} — ${m.title}`,
          }),
        ),
      );
    } catch {
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }

  async function restore() {
    onDone(row.id);
    try {
      await fetch(`/api/meetings/${row.id}/skip`, { method: "DELETE" });
    } finally {
      router.refresh();
    }
  }

  async function move() {
    if (!selected) return;
    setError(null);
    try {
      const res = await fetch(`/api/meetings/${row.id}/move-notes`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetMeetingId: selected }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(
          data.error === "target-occupied"
            ? "That meeting already has generated notes."
            : "Couldn’t move the notes.",
        );
        return;
      }
      onDone(row.id);
      router.refresh();
    } catch {
      setError("Couldn’t move the notes.");
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
          onClick={() => {
            const next = !moving;
            setMoving(next);
            if (next) loadMeetings(date);
          }}
        >
          Move…
        </button>
      </div>
      {moving && (
        <div className="incoming-match">
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              if (e.target.value) loadMeetings(e.target.value);
            }}
          />
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            <option value="">
              {loading ? "Loading…" : "Select a meeting…"}
            </option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary-btn"
            disabled={!selected}
            onClick={move}
          >
            Move notes
          </button>
          {error && <span className="skipped-notes-error">{error}</span>}
        </div>
      )}
    </div>
  );
}
