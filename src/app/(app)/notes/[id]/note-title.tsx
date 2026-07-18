"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Inline title editor: saves on blur/Enter (titles are short — no autosave
// interleaving with the body editor). Empty renders as "Untitled" elsewhere.
export function NoteTitle({
  noteId,
  initialTitle,
}: {
  noteId: string;
  initialTitle: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [saved, setSaved] = useState(initialTitle);

  async function save() {
    const next = title.trim();
    if (next === saved) return;
    setSaved(next);
    try {
      const res = await fetch(`/api/notes/${noteId}`, {
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

  return (
    <input
      className="note-title-input"
      value={title}
      placeholder="Untitled"
      aria-label="Note title"
      autoFocus={initialTitle === ""}
      onChange={(e) => setTitle(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
