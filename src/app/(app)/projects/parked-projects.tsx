"use client";

import Link from "next/link";
import { useState } from "react";
import { ConfirmDialog } from "../confirm-dialog";

type Row = { id: string; name: string };

// The shelf for ideas captured mid-meeting. Promote turns one into a real
// project; archive/delete clear the ones that turned out not to matter.
export function ParkedProjects({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);

  async function setStatus(id: string, status: "active" | "archived") {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
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
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setRows(prev);
    }
  }

  if (rows.length === 0) {
    return (
      <p className="muted empty-sm">
        No parked ideas. They show up here when you capture one from a
        meeting&apos;s Related projects rail.
      </p>
    );
  }

  return (
    <>
      <ul className="hidden-list">
        {rows.map((p) => (
          <li key={p.id} className="hidden-row">
            <Link href={`/projects/${p.id}`} className="hidden-title">
              {p.name}
            </Link>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setStatus(p.id, "active")}
            >
              Promote
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setStatus(p.id, "archived")}
            >
              Archive
            </button>
            <button
              type="button"
              className="row-action danger"
              onClick={() => setConfirmDelete(p)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirmDelete !== null}
        title="Delete this idea?"
        message="Its connections to other projects go with it. This can't be undone."
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          const target = confirmDelete;
          setConfirmDelete(null);
          if (target) void remove(target.id);
        }}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
