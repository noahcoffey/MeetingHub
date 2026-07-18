"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../confirm-dialog";

export function DeleteNoteButton({ noteId }: { noteId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/notes/${noteId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/notes");
        router.refresh();
        return;
      }
    } catch {
      /* fall through */
    }
    setBusy(false);
    setConfirmOpen(false);
  }

  return (
    <>
      <button
        type="button"
        className="meeting-delete-btn"
        onClick={() => setConfirmOpen(true)}
        disabled={busy}
      >
        Delete note
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this note?"
        message="The note is removed everywhere; attached projects and meetings are untouched. This can't be undone."
        confirmLabel="Delete note"
        busyLabel="Deleting…"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
