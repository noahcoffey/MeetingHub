"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

export type DayTask = {
  id: string;
  content: string;
  dueDate: string | null;
  createdDay: string;
  meetingId: string | null;
};

function shortDate(d: string) {
  const [y, m, day] = d.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, day, 12)));
}

// Open tasks relevant to the selected day: due on it (first), then created on it
// (second). A task both due and created that day shows once, under Due.
export function DayTasks({
  date,
  items: initial,
}: {
  date: string;
  items: DayTask[];
}) {
  const [items, setItems] = useState(initial);

  const sig = JSON.stringify(initial);
  useEffect(() => {
    setItems(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  async function complete(id: string) {
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== id));
    try {
      const res = await fetch(`/api/action-items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setItems(prev);
    }
  }

  const due = items.filter((it) => it.dueDate === date);
  const dueIds = new Set(due.map((it) => it.id));
  const created = items.filter(
    (it) => !dueIds.has(it.id) && it.createdDay === date,
  );
  if (due.length + created.length === 0) return null;

  const groups = [
    { key: "due", label: `Due ${shortDate(date)}`, items: due },
    { key: "created", label: `Created ${shortDate(date)}`, items: created },
  ].filter((g) => g.items.length > 0);

  return (
    <section className="day-tasks">
      <h2 className="day-tasks-title">Tasks</h2>
      {groups.map((g) => (
        <div className="day-tasks-group" key={g.key}>
          <div className="day-tasks-head">
            {g.label}
            <span className="count">{g.items.length}</span>
          </div>
          <ul className="day-tasks-items">
            {g.items.map((it) => (
              <li className="day-task" key={it.id}>
                <input
                  type="checkbox"
                  aria-label="Complete"
                  checked={false}
                  onChange={() => complete(it.id)}
                />
                {it.meetingId ? (
                  <Link
                    href={`/meetings/${it.meetingId}`}
                    className="day-task-content"
                  >
                    {it.content}
                  </Link>
                ) : (
                  <span className="day-task-content">{it.content}</span>
                )}
                {it.dueDate && it.dueDate !== date && (
                  <span
                    className={`day-task-due ${it.dueDate < date ? "overdue" : ""}`}
                  >
                    {shortDate(it.dueDate)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
