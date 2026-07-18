"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Row = { id: string; title: string };

// Exact meeting titles linked to this person — the manual complement to
// attendee-email matching (and the repair tool when the ICS feed lacks emails).
export function LinkedTitlesManager({
  personId,
  initial,
}: {
  personId: string;
  initial: Row[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);

  // Re-sync when the server sends new data (router.refresh() after add).
  const signature = JSON.stringify(initial);
  useEffect(() => {
    setRows(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = title.trim();
    if (!value) return;
    setAdding(true);
    try {
      const res = await fetch(`/api/people/${personId}/titles`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: value }),
      });
      if (!res.ok) throw new Error();
      setTitle("");
      router.refresh();
    } catch {
      /* keep input populated */
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    const prev = rows;
    setRows((r) => r.filter((x) => x.id !== id));
    try {
      const res = await fetch(`/api/people/${personId}/titles/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setRows(prev);
    }
  }

  return (
    <>
      {rows.length > 0 && (
        <ul className="hidden-list">
          {rows.map((t) => (
            <li key={t.id} className="hidden-row">
              <span className="hidden-title">{t.title}</span>
              <button
                type="button"
                className="ghost-btn ghost-btn-sm"
                onClick={() => remove(t.id)}
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="linked-title-form" onSubmit={add}>
        <input
          type="text"
          placeholder="Exact meeting title, e.g. “Weekly 1:1”"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button type="submit" className="ghost-btn" disabled={adding || !title.trim()}>
          Link
        </button>
      </form>
    </>
  );
}
