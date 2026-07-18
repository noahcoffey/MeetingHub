"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Creates a note (optionally pre-attached to a project/meeting) and jumps
// straight into its editor — same create-then-redirect flow as meetings.
export function NewNoteButton({
  projectId,
  meetingId,
  label = "New note",
  className = "primary-btn",
}: {
  projectId?: string;
  meetingId?: string;
  label?: string;
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, meetingId }),
      });
      if (res.ok) {
        const data = (await res.json()) as { note: { id: string } };
        router.push(`/notes/${data.note.id}`);
        return;
      }
    } catch {
      /* fall through */
    }
    setBusy(false);
  }

  return (
    <button type="button" className={className} onClick={create} disabled={busy}>
      {busy ? "Creating…" : label}
    </button>
  );
}
