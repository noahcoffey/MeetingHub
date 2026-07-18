"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "./confirm-dialog";

export type MeetingRow = {
  id: string;
  title: string;
  time: string;
  source: string;
  hasNotes: boolean;
  hasGenerated: boolean;
  projectName?: string | null;
};

export function MeetingList({ initial }: { initial: MeetingRow[] }) {
  const [rows, setRows] = useState(initial);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  // Re-sync when the server sends new data (date change, or import → router.refresh()).
  // useState only seeds once, so without this the list would show stale rows.
  const signature = JSON.stringify(initial);
  useEffect(() => {
    setRows(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  async function skip(id: string) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/meetings/${id}/skip`, { method: "POST" });
      if (!res.ok) throw new Error();
    } catch {
      setRows(prev);
    }
  }

  async function hide(title: string) {
    const prev = rows;
    // Hiding a title removes every matching meeting from view.
    setRows((r) => r.filter((x) => x.title !== title));
    try {
      const res = await fetch("/api/hidden-titles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRows(prev);
    }
  }

  async function remove(id: string) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/meetings/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setRows(prev);
    }
  }

  if (rows.length === 0) {
    return <p className="muted empty">No meetings for this day.</p>;
  }

  return (
    <>
      <ul className="meeting-list">
        {rows.map((m) => (
        <li key={m.id} className="meeting-li">
          <Link href={`/meetings/${m.id}`} className="meeting-row">
            <span className="meeting-time">{m.time}</span>
            <span className="meeting-title">{m.title}</span>
            {m.hasGenerated ? (
              <span className="badge badge-notes-plus">Notes+</span>
            ) : (
              m.hasNotes && <span className="badge">Notes</span>
            )}
            {m.source === "calendar" && <span className="badge">calendar</span>}
            {m.projectName && (
              <span className="badge badge-project">{m.projectName}</span>
            )}
          </Link>
          <div className="meeting-actions">
            {m.source === "manual" ? (
              <button
                type="button"
                className="row-action danger"
                onClick={() => setPendingDelete(m.id)}
                title="Delete this meeting permanently"
              >
                Delete
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="row-action"
                  onClick={() => skip(m.id)}
                  title="Hide this meeting from today's view"
                >
                  Skip today
                </button>
                <button
                  type="button"
                  className="row-action"
                  onClick={() => hide(m.title)}
                  title="Hide this and all future meetings with this title"
                >
                  Hide
                </button>
              </>
            )}
          </div>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this meeting?"
        message="This meeting and its action items will be removed. This can't be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          const id = pendingDelete;
          setPendingDelete(null);
          if (id) void remove(id);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
