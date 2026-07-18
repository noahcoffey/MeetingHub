"use client";

import Link from "next/link";
import { useState } from "react";

type Row = { id: string; name: string };

export function ArchivedProjects({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);

  async function reactivate(id: string) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "active" }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRows(prev);
    }
  }

  if (rows.length === 0) {
    return <p className="muted empty-sm">No archived projects.</p>;
  }

  return (
    <ul className="hidden-list">
      {rows.map((p) => (
        <li key={p.id} className="hidden-row">
          <Link href={`/projects/${p.id}`} className="hidden-title">
            {p.name}
          </Link>
          <button type="button" className="ghost-btn" onClick={() => reactivate(p.id)}>
            Reactivate
          </button>
        </li>
      ))}
    </ul>
  );
}
