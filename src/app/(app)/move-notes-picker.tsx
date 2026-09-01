"use client";

import { useEffect, useState } from "react";

// Date + meeting picker that POSTs /api/meetings/[source]/move-notes, carrying
// the source's generated (Notes+) notes onto the chosen meeting. Shared by the
// skipped-meeting banner on the day view and the Generated notes header on the
// meeting detail — the recorder occasionally files notes under the wrong
// occurrence, and this is the one way to put them right.
export function MoveNotesPicker({
  sourceMeetingId,
  initialDate,
  disabled = false,
  onMoved,
}: {
  sourceMeetingId: string;
  // Seeds the date input — the mis-filed meeting is almost always the same day.
  initialDate: string;
  // e.g. while an autosave of the notes is still in flight.
  disabled?: boolean;
  onMoved: (targetMeetingId: string) => void;
}) {
  const [date, setDate] = useState(initialDate);
  const [meetings, setMeetings] = useState<{ id: string; label: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setLoading(true);
    setSelected("");
    fetch(`/api/meetings?date=${date}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setMeetings(
          (data.meetings ?? [])
            // A live source sits on its own day; moving onto itself is a 400.
            .filter((m: { id: string }) => m.id !== sourceMeetingId)
            .map((m: { id: string; title: string; startTime: string }) => ({
              id: m.id,
              label: `${new Date(m.startTime).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })} — ${m.title}`,
            })),
        );
      })
      .catch(() => {
        if (!cancelled) setMeetings([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, sourceMeetingId]);

  async function move() {
    if (!selected || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${sourceMeetingId}/move-notes`, {
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
      onMoved(selected);
    } catch {
      setError("Couldn’t move the notes.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="incoming-match move-notes-picker">
      <input
        type="date"
        value={date}
        aria-label="Day of the target meeting"
        onChange={(e) => setDate(e.target.value)}
      />
      <select
        value={selected}
        aria-label="Target meeting"
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">
          {loading
            ? "Loading…"
            : meetings.length === 0
              ? "No other meetings that day"
              : "Select a meeting…"}
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
        disabled={!selected || busy || disabled}
        title={disabled ? "Waiting for the notes to finish saving" : undefined}
        onClick={move}
      >
        Move notes
      </button>
      {error && <span className="skipped-notes-error">{error}</span>}
    </div>
  );
}
