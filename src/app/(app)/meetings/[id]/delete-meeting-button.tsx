"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../confirm-dialog";

// Delete control for manual ("custom") meetings, shown in the detail header.
export function DeleteMeetingButton({
  meetingId,
  backDate,
}: {
  meetingId: string;
  backDate: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/meetings/${meetingId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        router.push(`/meetings?date=${backDate}`);
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
        Delete meeting
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this meeting?"
        message="This meeting and its action items will be removed. This can't be undone."
        confirmLabel="Delete meeting"
        busyLabel="Deleting…"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
