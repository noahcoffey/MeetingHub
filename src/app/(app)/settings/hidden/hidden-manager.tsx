"use client";

import { useState } from "react";

type Row = { id: string; title: string };

export function HiddenTitlesManager({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState(initial);

  async function unhide(id: string) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/hidden-titles/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setRows(prev);
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-h2">Hidden meetings</h2>
      <p className="muted settings-desc">
        Meetings with these exact titles are hidden from your list, including
        future ones. Unhide to show them again.
      </p>
      {rows.length === 0 ? (
        <p className="muted empty-sm">Nothing hidden.</p>
      ) : (
        <ul className="hidden-list">
          {rows.map((t) => (
            <li key={t.id} className="hidden-row">
              <span className="hidden-title">{t.title}</span>
              <button
                type="button"
                className="ghost-btn"
                onClick={() => unhide(t.id)}
              >
                Unhide
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
