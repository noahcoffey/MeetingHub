"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type IncomingItem = {
  id: string;
  title: string;
  when: string;
  defaultDate: string;
  preview: string;
  // Tagged destination from the push's workspace hint (null = untagged).
  workspaceId: string | null;
  workspaceLabel: string | null;
};

export function IncomingManager({ initial }: { initial: IncomingItem[] }) {
  const router = useRouter();
  const [rows, setRows] = useState(initial);

  function drop(id: string) {
    setRows((r) => r.filter((x) => x.id !== id));
  }

  async function post(id: string, body: object) {
    return fetch(`/api/pending-ingests/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  async function create(id: string) {
    drop(id);
    try {
      await post(id, { action: "create" });
    } finally {
      router.refresh();
    }
  }
  async function match(id: string, meetingId: string) {
    drop(id);
    try {
      await post(id, { action: "match", meetingId });
    } finally {
      router.refresh();
    }
  }
  async function discard(id: string) {
    drop(id);
    try {
      await fetch(`/api/pending-ingests/${id}`, { method: "DELETE" });
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-h2">Incoming notes</h2>
      <p className="muted settings-desc">
        Generated notes pushed to the ingest API that didn’t match a meeting. Match each
        to an existing meeting, or create a new one.{" "}
        <a href="/api-docs.html#ingest" target="_blank" rel="noopener noreferrer">
          Ingest API documentation ↗
        </a>
      </p>
      {rows.length === 0 ? (
        <p className="muted empty-sm">Nothing to review.</p>
      ) : (
        <ul className="incoming-list">
          {rows.map((it) => (
            <IncomingRow
              key={it.id}
              item={it}
              onCreate={create}
              onMatch={match}
              onDiscard={discard}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function IncomingRow({
  item,
  onCreate,
  onMatch,
  onDiscard,
}: {
  item: IncomingItem;
  onCreate: (id: string) => void;
  onMatch: (id: string, meetingId: string) => void;
  onDiscard: (id: string) => void;
}) {
  const [matching, setMatching] = useState(false);
  const [date, setDate] = useState(item.defaultDate);
  const [meetings, setMeetings] = useState<{ id: string; label: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);

  async function loadMeetings(d: string) {
    setLoading(true);
    setSelected("");
    try {
      // A tagged item matches against ITS workspace's meetings, wherever the
      // review happens from.
      const ws = item.workspaceId
        ? `&workspace=${encodeURIComponent(item.workspaceId)}`
        : "";
      const res = await fetch(`/api/meetings?date=${d}${ws}`);
      const data = await res.json();
      setMeetings(
        (data.meetings ?? []).map(
          (m: { id: string; title: string; startTime: string }) => ({
            id: m.id,
            label: `${new Date(m.startTime).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })} — ${m.title}`,
          }),
        ),
      );
    } catch {
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <li className="incoming-row">
      <div className="incoming-head">
        <div className="incoming-meta">
          <div className="incoming-title">{item.title}</div>
          <div className="incoming-when">
            {item.when}
            {item.workspaceLabel && <> · {item.workspaceLabel}</>}
          </div>
        </div>
        <div className="incoming-actions">
          <button
            type="button"
            className="primary-btn"
            onClick={() => onCreate(item.id)}
          >
            Create meeting
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              const next = !matching;
              setMatching(next);
              if (next) loadMeetings(date);
            }}
          >
            Match…
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => onDiscard(item.id)}
          >
            Discard
          </button>
        </div>
      </div>

      <details className="incoming-preview">
        <summary>Preview notes</summary>
        <pre>{item.preview}</pre>
      </details>

      {matching && (
        <div className="incoming-match">
          <input
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              if (e.target.value) loadMeetings(e.target.value);
            }}
          />
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">
              {loading ? "Loading…" : "Select a meeting…"}
            </option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="primary-btn"
            disabled={!selected}
            onClick={() => onMatch(item.id, selected)}
          >
            Match
          </button>
        </div>
      )}
    </li>
  );
}
