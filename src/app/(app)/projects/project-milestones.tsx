"use client";

import { useState } from "react";

export type ClientMilestone = {
  id: string;
  name: string;
  dueDate: string | null;
  completed: boolean;
  total: number;
  done: number;
};

// "Jul 24" from a YYYY-MM-DD string (UTC-noon anchored, matching the hub page).
function formatShortDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(dt);
}

// Whole-day difference dueDate − today (both YYYY-MM-DD). Negative = overdue.
function dayDiff(dueDate: string, today: string): number {
  const toDays = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  };
  return toDays(dueDate) - toDays(today);
}

type ChipTone = "neutral" | "soon" | "late" | "ok";

function chipFor(
  dueDate: string | null,
  today: string,
  completed: boolean,
): { tone: ChipTone; label: string } {
  if (completed) {
    return dueDate === null
      ? { tone: "neutral", label: "no date" }
      : { tone: "ok", label: formatShortDateStr(dueDate) };
  }
  if (dueDate === null) return { tone: "neutral", label: "no date" };
  const diff = dayDiff(dueDate, today);
  if (diff < 0) return { tone: "late", label: `${formatShortDateStr(dueDate)} · overdue` };
  if (diff <= 7) return { tone: "soon", label: formatShortDateStr(dueDate) };
  return { tone: "neutral", label: formatShortDateStr(dueDate) };
}

export function ProjectMilestones({
  projectId,
  today,
  initial,
}: {
  projectId: string;
  today: string;
  initial: ClientMilestone[];
}) {
  const [list, setList] = useState(initial);
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editingDateId, setEditingDateId] = useState<string | null>(null);
  const [addingTaskId, setAddingTaskId] = useState<string | null>(null);
  const [taskText, setTaskText] = useState("");
  const [taskSaving, setTaskSaving] = useState(false);

  const open = list.filter((m) => !m.completed);
  const completed = list.filter((m) => m.completed);

  async function patch(id: string, body: Record<string, unknown>) {
    const prev = list;
    // Optimistic update applied by callers before calling; roll back on failure.
    try {
      const res = await fetch(`/api/milestones/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
    } catch {
      setList(prev);
    }
  }

  async function addMilestone(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/milestones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          name: name.trim(),
          dueDate: date || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add milestone");
      const m = data.milestone;
      setList((prev) => [
        ...prev,
        {
          id: m.id,
          name: m.name,
          dueDate: m.dueDate,
          completed: m.completedAt !== null,
          total: 0,
          done: 0,
        },
      ]);
      setName("");
      setDate("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add milestone");
    } finally {
      setSaving(false);
    }
  }

  function toggleComplete(id: string, completed: boolean) {
    setList((prev) => prev.map((m) => (m.id === id ? { ...m, completed } : m)));
    patch(id, { completed });
  }

  function saveName(id: string) {
    const trimmed = editName.trim();
    setEditingNameId(null);
    if (!trimmed) return;
    const current = list.find((m) => m.id === id);
    if (!current || current.name === trimmed) return;
    setList((prev) => prev.map((m) => (m.id === id ? { ...m, name: trimmed } : m)));
    patch(id, { name: trimmed });
  }

  function setDue(id: string, dueDate: string | null) {
    setEditingDateId(null);
    setList((prev) => prev.map((m) => (m.id === id ? { ...m, dueDate } : m)));
    patch(id, { dueDate });
  }

  // Quick-add a task born linked to this milestone (and thus this project).
  async function addTask(milestoneId: string) {
    const content = taskText.trim();
    if (!content) return;
    setTaskSaving(true);
    try {
      const res = await fetch("/api/action-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, projectId, milestoneId }),
      });
      if (!res.ok) throw new Error();
      setList((prev) =>
        prev.map((m) =>
          m.id === milestoneId ? { ...m, total: m.total + 1 } : m,
        ),
      );
      setTaskText("");
      setAddingTaskId(null);
    } catch {
      /* keep the input populated so the text isn't lost */
    } finally {
      setTaskSaving(false);
    }
  }

  async function remove(id: string) {
    const target = list.find((m) => m.id === id);
    if (target && target.total > 0) {
      const ok = window.confirm(
        `Detaches ${target.total} linked task${target.total === 1 ? "" : "s"} — they won't be deleted. Remove this milestone?`,
      );
      if (!ok) return;
    }
    const prev = list;
    setList((ms) => ms.filter((m) => m.id !== id));
    try {
      const res = await fetch(`/api/milestones/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setList(prev);
    }
  }

  function renderRow(m: ClientMilestone) {
    const chip = chipFor(m.dueDate, today, m.completed);
    const pct = m.total > 0 ? Math.round((m.done / m.total) * 100) : 0;
    const overdue =
      !m.completed && m.dueDate !== null && dayDiff(m.dueDate, today) < 0;
    const fillColor = m.completed
      ? "var(--done)"
      : overdue
        ? "var(--danger)"
        : "var(--accent)";
    const fillWidth = m.completed ? 100 : pct;
    return (
      <li key={m.id} className="msrow">
        <div className="msrow-line1">
          <input
            type="checkbox"
            className="msrow-check"
            checked={m.completed}
            aria-label={m.completed ? "Reopen milestone" : "Mark milestone done"}
            onChange={(e) => toggleComplete(m.id, e.target.checked)}
          />
          {editingNameId === m.id ? (
            <input
              type="text"
              className="msrow-name-input"
              value={editName}
              autoFocus
              onChange={(e) => setEditName(e.target.value)}
              onBlur={() => saveName(m.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveName(m.id);
                if (e.key === "Escape") setEditingNameId(null);
              }}
            />
          ) : (
            <button
              type="button"
              className={`msrow-name ${m.completed ? "msrow-done" : ""}`}
              onClick={() => {
                setEditingNameId(m.id);
                setEditName(m.name);
              }}
              title="Rename milestone"
            >
              {m.name}
            </button>
          )}
          {editingDateId === m.id ? (
            <span className="msrow-date-edit">
              <input
                type="date"
                className="msrow-date-input"
                defaultValue={m.dueDate ?? ""}
                autoFocus
                onChange={(e) => setDue(m.id, e.target.value || null)}
                onBlur={() => setEditingDateId(null)}
              />
              {m.dueDate !== null && (
                <button
                  type="button"
                  className="msrow-date-clear"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setDue(m.id, null);
                  }}
                >
                  Clear
                </button>
              )}
            </span>
          ) : (
            <button
              type="button"
              className={`msrow-chip ${chip.tone}`}
              onClick={() => setEditingDateId(m.id)}
              title="Set due date"
            >
              {chip.label}
            </button>
          )}
          <span className={`msrow-count ${m.total === 0 ? "muted" : ""}`}>
            {m.total === 0 ? "no tasks" : `${m.done}/${m.total}`}
          </span>
          {m.completed ? (
            <button
              type="button"
              className="msrow-reopen"
              onClick={() => toggleComplete(m.id, false)}
            >
              Reopen
            </button>
          ) : (
            <>
              <button
                type="button"
                className="msrow-task-add"
                title="Add a task to this milestone"
                onClick={() => {
                  setTaskText("");
                  setAddingTaskId(addingTaskId === m.id ? null : m.id);
                }}
              >
                + task
              </button>
              <button
                type="button"
                className="msrow-remove"
                aria-label="Remove milestone"
                onClick={() => remove(m.id)}
              >
                ×
              </button>
            </>
          )}
        </div>
        {addingTaskId === m.id && !m.completed && (
          <div className="msrow-task-form">
            <input
              type="text"
              placeholder="Task for this milestone…"
              value={taskText}
              autoFocus
              onChange={(e) => setTaskText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addTask(m.id);
                if (e.key === "Escape") setAddingTaskId(null);
              }}
            />
            <button
              type="button"
              className="primary-btn"
              disabled={taskSaving || !taskText.trim()}
              onClick={() => addTask(m.id)}
            >
              Add
            </button>
          </div>
        )}
        <span className="msrow-under">
          {m.total > 0 || m.completed ? (
            <i style={{ width: `${fillWidth}%`, background: fillColor }} />
          ) : null}
        </span>
      </li>
    );
  }

  return (
    <div className="msrow-wrap">
      {open.length === 0 && completed.length === 0 && (
        <p className="muted empty-sm">No milestones yet.</p>
      )}

      {open.length > 0 && <ul className="msrow-list">{open.map(renderRow)}</ul>}

      {completed.length > 0 && (
        <details className="hub-collapsible">
          <summary>Show {completed.length} completed</summary>
          <ul className="msrow-list msrow-list-done">{completed.map(renderRow)}</ul>
        </details>
      )}

      <form className="msrow-add" onSubmit={addMilestone}>
        <input
          type="text"
          placeholder="Milestone name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <button type="submit" className="primary-btn" disabled={saving || !name.trim()}>
          {saving ? "Adding…" : "Add"}
        </button>
      </form>
      {error && <p className="login-error">{error}</p>}
    </div>
  );
}
