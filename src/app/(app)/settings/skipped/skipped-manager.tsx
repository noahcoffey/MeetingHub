"use client";

import { useState } from "react";

type Row = { id: string; title: string; when: string };

export function SkippedManager({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);

  async function unskip(id: string) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/meetings/${id}/skip`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setRows(prev);
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-h2">Skipped meetings</h2>
      <p className="muted settings-desc">
        Individual meeting occurrences you’ve skipped from the list. Restore one
        to show it again.
      </p>
      {rows.length === 0 ? (
        <p className="muted empty-sm">Nothing skipped.</p>
      ) : (
        <ul className="hidden-list">
          {rows.map((m) => (
            <li key={m.id} className="hidden-row">
              <span className="hidden-title">
                {m.title}
                <span className="skipped-when">{m.when}</span>
              </span>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => unskip(m.id)}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
