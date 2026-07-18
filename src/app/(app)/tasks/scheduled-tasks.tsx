"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type ScheduledTaskRow = {
  id: string;
  content: string;
  // e.g. "Weekly · resurfaces Jul 22" or "Snoozed · resurfaces Jul 16"
  meta: string;
  // Snoozed rows get an Unsnooze button; scheduled-recurring ones resurface
  // on their own and can't be brought forward from here.
  snoozed: boolean;
};

// Collapsed list of hidden-until-due tasks (future recurring + snoozed).
export function ScheduledTasks({ initialItems }: { initialItems: ScheduledTaskRow[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);

  // Re-sync when the server sends new data (router.refresh() after snoozing
  // from the main list above).
  const signature = JSON.stringify(initialItems);
  useEffect(() => {
    setItems(initialItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  async function unsnooze(id: string) {
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== id));
    try {
      const res = await fetch(`/api/action-items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snoozedUntil: null }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setItems(prev);
    }
  }

  if (items.length === 0) return null;

  return (
    <details className="hub-collapsible scheduled-tasks">
      <summary>
        {items.length} scheduled or snoozed task{items.length === 1 ? "" : "s"} —
        hidden until due
      </summary>
      <ul className="scheduled-list">
        {items.map((it) => (
          <li key={it.id} className="scheduled-row">
            <span className="scheduled-content">{it.content}</span>
            <span className="scheduled-meta">
              {it.meta}
              {it.snoozed && (
                <button
                  type="button"
                  className="link-btn scheduled-unsnooze"
                  onClick={() => unsnooze(it.id)}
                >
                  Unsnooze
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
