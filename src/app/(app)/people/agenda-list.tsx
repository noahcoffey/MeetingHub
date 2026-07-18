"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export type AgendaClientItem = {
  id: string;
  personId: string;
  content: string;
};

// Open agenda items ("raise this next time"), grouped per person when more
// than one is shown. Checking an item marks it discussed — recorded against
// `discussedMeetingId` when used from a meeting rail, or with no meeting when
// checked from the person page. Reopening lives in the person page history.
export function AgendaList({
  people,
  initialItems,
  discussedMeetingId,
}: {
  people: { id: string; name: string }[];
  initialItems: AgendaClientItem[];
  discussedMeetingId: string | null;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  // Re-sync when the server sends new data (router.refresh() after changes).
  const signature = JSON.stringify(initialItems);
  useEffect(() => {
    setItems(initialItems);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  async function add(personId: string) {
    const content = (drafts[personId] ?? "").trim();
    if (!content) return;
    setBusy(true);
    try {
      const res = await fetch("/api/agenda-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ personId, content }),
      });
      if (!res.ok) throw new Error();
      const { item } = (await res.json()) as { item: AgendaClientItem };
      setItems((p) => [...p, { id: item.id, personId, content }]);
      setDrafts((d) => ({ ...d, [personId]: "" }));
      router.refresh();
    } catch {
      /* keep draft populated */
    } finally {
      setBusy(false);
    }
  }

  async function discuss(id: string) {
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== id));
    try {
      const res = await fetch(`/api/agenda-items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ discussed: { meetingId: discussedMeetingId } }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setItems(prev);
    }
  }

  async function remove(id: string) {
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== id));
    try {
      const res = await fetch(`/api/agenda-items/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setItems(prev);
    }
  }

  const showGroups = people.length > 1;

  return (
    <div className="agenda-list">
      {people.map((person) => {
        const personItems = items.filter((it) => it.personId === person.id);
        return (
          <div key={person.id} className="agenda-group">
            {showGroups && <div className="agenda-group-head">{person.name}</div>}
            {personItems.length > 0 && (
              <ul className="agenda-items">
                {personItems.map((it) => (
                  <li key={it.id} className="agenda-row">
                    <input
                      type="checkbox"
                      aria-label="Mark discussed"
                      checked={false}
                      onChange={() => discuss(it.id)}
                    />
                    <span className="agenda-content">{it.content}</span>
                    <button
                      type="button"
                      className="note-remove"
                      aria-label="Delete agenda item"
                      onClick={() => remove(it.id)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="agenda-add"
              onSubmit={(e) => {
                e.preventDefault();
                void add(person.id);
              }}
            >
              <input
                type="text"
                placeholder={
                  showGroups
                    ? `Raise with ${person.name}…`
                    : "Raise next time…"
                }
                value={drafts[person.id] ?? ""}
                onChange={(e) =>
                  setDrafts((d) => ({ ...d, [person.id]: e.target.value }))
                }
                disabled={busy}
              />
            </form>
          </div>
        );
      })}
    </div>
  );
}
