"use client";

import { useState } from "react";

type StatType = "scale" | "number" | "boolean" | "text";
type Direction = "good" | "bad" | "neutral";
type Config = {
  labels?: string[];
  min?: number;
  max?: number;
  unit?: string;
  placeholder?: string;
};
type Row = {
  id: string;
  name: string;
  type: StatType;
  direction: Direction;
  config: Config;
  showOnDashboard: boolean;
  archived: boolean;
  sortOrder: number;
};

const TYPE_LABELS: Record<StatType, string> = {
  scale: "Scale",
  number: "Number",
  boolean: "Yes / No",
  text: "Text",
};

const isNumeric = (t: StatType) => t !== "text";

export function JournalStatsManager({ initial }: { initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(
    [...initial].sort((a, b) => a.sortOrder - b.sortOrder),
  );
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<StatType>("scale");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const active = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);

  function replaceRow(item: Row) {
    setRows((rs) => rs.map((r) => (r.id === item.id ? { ...r, ...item } : r)));
  }

  async function patchStat(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/journal-stats/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const { item } = await res.json();
      if (item)
        replaceRow({
          id: item.id,
          name: item.name,
          type: item.type,
          direction: item.direction,
          config: item.config,
          showOnDashboard: item.showOnDashboard,
          archived: item.archivedAt != null,
          sortOrder: item.sortOrder,
        });
    }
  }

  async function addStat() {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/journal-stats", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          type: newType,
          direction: isNumeric(newType) ? "good" : "neutral",
          showOnDashboard: false,
        }),
      });
      if (res.ok) {
        const { item } = await res.json();
        setRows((rs) => [
          ...rs,
          {
            id: item.id,
            name: item.name,
            type: item.type,
            direction: item.direction,
            config: item.config,
            showOnDashboard: item.showOnDashboard,
            archived: false,
            sortOrder: item.sortOrder,
          },
        ]);
        setNewName("");
        setNewType("scale");
      }
    } finally {
      setBusy(false);
    }
  }

  async function move(id: string, dir: -1 | 1) {
    const ids = active.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    // Reflect new order locally (assign sequential sortOrder to active rows).
    setRows((rs) => {
      const order = new Map(ids.map((sid, idx) => [sid, idx]));
      return rs.map((r) =>
        order.has(r.id) ? { ...r, sortOrder: order.get(r.id)! } : r,
      );
    });
    await fetch("/api/journal-stats", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderedIds: ids }),
    });
  }

  async function remove(id: string) {
    await fetch(`/api/journal-stats/${id}`, { method: "DELETE" });
    setRows((rs) => rs.filter((r) => r.id !== id));
    setConfirmDelete(null);
  }

  return (
    <section className="settings-section">
      <h2 className="settings-h2">Journal stats</h2>
      <p className="muted settings-desc">
        Metrics you log on each journal entry. Scales and numbers appear on the
        reports charts; the ones flagged for the dashboard show a trend card.
        Archiving keeps past values but removes a stat from the journal panel.
      </p>

      <div className="stat-add">
        <input
          className="stat-add-name"
          placeholder="New stat name (e.g. Sleep quality)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void addStat();
          }}
        />
        <select
          className="stat-add-type"
          value={newType}
          onChange={(e) => setNewType(e.target.value as StatType)}
          aria-label="Stat type"
        >
          {(Object.keys(TYPE_LABELS) as StatType[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="primary-btn"
          disabled={busy || !newName.trim()}
          onClick={() => void addStat()}
        >
          Add stat
        </button>
      </div>

      {active.length === 0 ? (
        <p className="muted empty-sm">No stats yet.</p>
      ) : (
        <ul className="stat-list">
          {active.map((r, i) => (
            <StatRow
              key={r.id}
              row={r}
              first={i === 0}
              last={i === active.length - 1}
              confirming={confirmDelete === r.id}
              onPatch={(body) => void patchStat(r.id, body)}
              onMove={(dir) => void move(r.id, dir)}
              onArchive={() => void patchStat(r.id, { archived: true })}
              onAskDelete={() => setConfirmDelete(r.id)}
              onCancelDelete={() => setConfirmDelete(null)}
              onDelete={() => void remove(r.id)}
            />
          ))}
        </ul>
      )}

      {archived.length > 0 && (
        <>
          <h3 className="stat-archived-h">Archived</h3>
          <ul className="stat-list archived">
            {archived.map((r) => (
              <li key={r.id} className="stat-row archived">
                <div className="stat-row-head">
                  <span className="stat-name-static">{r.name}</span>
                  <span className="stat-type-badge">{TYPE_LABELS[r.type]}</span>
                  <div className="stat-row-actions">
                    <button
                      type="button"
                      className="ghost-btn"
                      onClick={() => void patchStat(r.id, { archived: false })}
                    >
                      Restore
                    </button>
                    {confirmDelete === r.id ? (
                      <>
                        <button
                          type="button"
                          className="danger-btn"
                          onClick={() => void remove(r.id)}
                        >
                          Really delete
                        </button>
                        <button
                          type="button"
                          className="ghost-btn"
                          onClick={() => setConfirmDelete(null)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="ghost-btn danger"
                        onClick={() => setConfirmDelete(r.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function StatRow({
  row,
  first,
  last,
  confirming,
  onPatch,
  onMove,
  onArchive,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  row: Row;
  first: boolean;
  last: boolean;
  confirming: boolean;
  onPatch: (body: Record<string, unknown>) => void;
  onMove: (dir: -1 | 1) => void;
  onArchive: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(row.name);

  return (
    <li className="stat-row">
      <div className="stat-row-head">
        <input
          className="stat-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            const n = name.trim();
            if (n && n !== row.name) onPatch({ name: n });
            else setName(row.name);
          }}
        />
        <span className="stat-type-badge">{TYPE_LABELS[row.type]}</span>
        <div className="stat-row-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Move up"
            disabled={first}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Move down"
            disabled={last}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button type="button" className="ghost-btn" onClick={onArchive}>
            Archive
          </button>
          {confirming ? (
            <>
              <button type="button" className="danger-btn" onClick={onDelete}>
                Really delete
              </button>
              <button
                type="button"
                className="ghost-btn"
                onClick={onCancelDelete}
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              className="ghost-btn danger"
              onClick={onAskDelete}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="stat-row-controls">
        {isNumeric(row.type) && (
          <>
            <label className="stat-ctl">
              <span>Direction</span>
              <select
                value={row.direction}
                onChange={(e) => onPatch({ direction: e.target.value })}
              >
                <option value="good">Higher is better</option>
                <option value="bad">Higher is worse</option>
                <option value="neutral">Neutral</option>
              </select>
            </label>
            <label className="stat-ctl stat-ctl-check">
              <input
                type="checkbox"
                checked={row.showOnDashboard}
                onChange={(e) => onPatch({ showOnDashboard: e.target.checked })}
              />
              <span>Show on dashboard</span>
            </label>
          </>
        )}
        <StatConfigEditor row={row} onPatch={onPatch} />
      </div>
    </li>
  );
}

function StatConfigEditor({
  row,
  onPatch,
}: {
  row: Row;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  if (row.type === "scale") {
    return <ScaleLabels row={row} onPatch={onPatch} />;
  }
  if (row.type === "number") {
    return <NumberConfig row={row} onPatch={onPatch} />;
  }
  if (row.type === "text") {
    return <TextConfig row={row} onPatch={onPatch} />;
  }
  return null;
}

function ScaleLabels({
  row,
  onPatch,
}: {
  row: Row;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const [labels, setLabels] = useState<string[]>(
    row.config.labels ?? ["1", "2", "3", "4", "5"],
  );
  const save = (next: string[]) => {
    const clean = next.map((l) => l.trim()).filter(Boolean);
    if (clean.length >= 2) onPatch({ config: { labels: clean } });
  };
  return (
    <div className="stat-labels">
      <span className="stat-ctl-label">Options (low → high)</span>
      <div className="stat-labels-row">
        {labels.map((l, i) => (
          <input
            key={i}
            className="stat-label-input"
            value={l}
            onChange={(e) =>
              setLabels((ls) => ls.map((x, j) => (j === i ? e.target.value : x)))
            }
            onBlur={() => save(labels)}
          />
        ))}
        {labels.length > 2 && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Remove last option"
            onClick={() => {
              const next = labels.slice(0, -1);
              setLabels(next);
              save(next);
            }}
          >
            −
          </button>
        )}
        {labels.length < 10 && (
          <button
            type="button"
            className="icon-btn"
            aria-label="Add option"
            onClick={() => setLabels((ls) => [...ls, ""])}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}

function NumberConfig({
  row,
  onPatch,
}: {
  row: Row;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const [min, setMin] = useState(row.config.min?.toString() ?? "");
  const [max, setMax] = useState(row.config.max?.toString() ?? "");
  const [unit, setUnit] = useState(row.config.unit ?? "");
  const save = () =>
    onPatch({
      config: {
        min: min === "" ? undefined : Number(min),
        max: max === "" ? undefined : Number(max),
        unit: unit.trim() || undefined,
      },
    });
  return (
    <div className="stat-number-config">
      <label className="stat-ctl">
        <span>Min</span>
        <input
          type="number"
          value={min}
          onChange={(e) => setMin(e.target.value)}
          onBlur={save}
        />
      </label>
      <label className="stat-ctl">
        <span>Max</span>
        <input
          type="number"
          value={max}
          onChange={(e) => setMax(e.target.value)}
          onBlur={save}
        />
      </label>
      <label className="stat-ctl">
        <span>Unit</span>
        <input
          type="text"
          value={unit}
          placeholder="e.g. h"
          onChange={(e) => setUnit(e.target.value)}
          onBlur={save}
        />
      </label>
    </div>
  );
}

function TextConfig({
  row,
  onPatch,
}: {
  row: Row;
  onPatch: (body: Record<string, unknown>) => void;
}) {
  const [ph, setPh] = useState(row.config.placeholder ?? "");
  return (
    <label className="stat-ctl stat-ctl-wide">
      <span>Placeholder</span>
      <input
        type="text"
        value={ph}
        placeholder="Prompt shown in the box"
        onChange={(e) => setPh(e.target.value)}
        onBlur={() => onPatch({ config: { placeholder: ph.trim() || undefined } })}
      />
    </label>
  );
}
