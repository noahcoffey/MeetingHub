"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Inline meeting rename. Display state is wrapping text (long titles must wrap
// on narrow screens, like the h1 it replaced); clicking swaps in an input that
// saves on blur/Enter (mirrors NoteTitle). Empty input reverts — a meeting
// title can't be blank. Renaming pins the title against ICS re-import
// server-side (title_edited_at).
export function MeetingTitle({
  meetingId,
  initialTitle,
}: {
  meetingId: string;
  initialTitle: string;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [saved, setSaved] = useState(initialTitle);

  async function save() {
    setEditing(false);
    const next = title.trim();
    if (next === saved) return;
    if (next === "") {
      setTitle(saved);
      return;
    }
    setSaved(next);
    setTitle(next);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      // Roll back so the UI doesn't lie about what's stored.
      setSaved(saved);
      setTitle(saved);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className="meeting-title-display"
        title="Rename meeting"
        onClick={() => setEditing(true)}
      >
        {saved}
      </button>
    );
  }

  return (
    <input
      className="meeting-title-input"
      value={title}
      aria-label="Meeting title"
      autoFocus
      onChange={(e) => setTitle(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === "Escape") {
          setTitle(saved);
          setEditing(false);
        }
      }}
    />
  );
}
