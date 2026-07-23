"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { WORKSPACE_FEATURES, type WorkspaceFeature } from "@/db/schema";
import { WorkspaceCalendarPicker } from "./workspace-calendar-picker";

type Row = {
  id: string;
  name: string;
  icsUrl: string | null;
  isDefault: boolean;
  sortOrder: number;
  disabledFeatures: WorkspaceFeature[];
  googleAccountId: string | null;
  googleCalendarId: string | null;
};

type GoogleAccountOption = { id: string; email: string };

const FEATURE_LABELS: Record<WorkspaceFeature, string> = {
  calendar: "Calendar import",
  meetings: "Meetings",
  projects: "Projects",
  people: "People",
  notes: "Notes",
  journal: "Journal",
  reports: "Reports",
  files: "Files",
};

type Counts = {
  meetings: number;
  actionItems: number;
  projects: number;
  people: number;
  notes: number;
  journalEntries: number;
  hiddenTitles: number;
  total: number;
};

function describeCounts(c: Counts): string {
  const parts: string[] = [];
  const push = (n: number, one: string, many: string) => {
    if (n > 0) parts.push(`${n} ${n === 1 ? one : many}`);
  };
  push(c.meetings, "meeting", "meetings");
  push(c.actionItems, "task", "tasks");
  push(c.projects, "project", "projects");
  push(c.people, "person", "people");
  push(c.notes, "note", "notes");
  push(c.journalEntries, "journal entry", "journal entries");
  push(c.hiddenTitles, "hidden title", "hidden titles");
  return parts.join(", ");
}

export function WorkspacesManager({
  initial,
  googleAccounts,
}: {
  initial: Row[];
  googleAccounts: GoogleAccountOption[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(
    [...initial].sort((a, b) => a.sortOrder - b.sortOrder),
  );

  async function saveGoogleCalendar(
    id: string,
    googleAccountId: string | null,
    googleCalendarId: string | null,
  ) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    setRows((r) =>
      r.map((x) => (x.id === id ? { ...x, googleAccountId, googleCalendarId } : x)),
    );
    try {
      const res = await fetch(`/api/workspaces/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ googleAccountId, googleCalendarId }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRows((r) => r.map((x) => (x.id === id ? row : x)));
    }
  }
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [blocked, setBlocked] = useState<Record<string, string>>({});

  async function patch(id: string, field: "name" | "icsUrl", value: string) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const current = field === "name" ? row.name : (row.icsUrl ?? "");
    if (value === current) return;
    // Empty name is rejected server-side, so don't bother sending it.
    if (field === "name" && value.trim() === "") return;
    const next =
      field === "name"
        ? { ...row, name: value.trim() }
        : { ...row, icsUrl: value.trim() || null };
    setRows((r) => r.map((x) => (x.id === id ? next : x)));
    try {
      const res = await fetch(`/api/workspaces/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [field]: value.trim() }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRows((r) => r.map((x) => (x.id === id ? row : x)));
    }
  }

  async function toggleFeature(id: string, feature: WorkspaceFeature) {
    const row = rows.find((r) => r.id === id);
    if (!row) return;
    const enabled = !row.disabledFeatures.includes(feature);
    // enabled → we're disabling it (add to list); disabled → enabling (remove).
    const nextDisabled = enabled
      ? [...row.disabledFeatures, feature]
      : row.disabledFeatures.filter((f) => f !== feature);
    setRows((r) =>
      r.map((x) =>
        x.id === id ? { ...x, disabledFeatures: nextDisabled } : x,
      ),
    );
    try {
      const res = await fetch(`/api/workspaces/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ disabledFeatures: nextDisabled }),
      });
      if (!res.ok) throw new Error();
    } catch {
      setRows((r) => r.map((x) => (x.id === id ? row : x)));
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      const { item } = (await res.json()) as { item: Row };
      setRows((r) =>
        [...r, item].sort((a, b) => a.sortOrder - b.sortOrder),
      );
      setNewName("");
      router.refresh();
    } catch {
      // leave the input so the user can retry
    } finally {
      setAdding(false);
    }
  }

  async function remove(id: string) {
    setBlocked((b) => {
      const { [id]: _drop, ...rest } = b;
      return rest;
    });
    try {
      const res = await fetch(`/api/workspaces/${id}`, { method: "DELETE" });
      if (res.status === 409) {
        const data = (await res.json()) as { counts: Counts };
        setBlocked((b) => ({
          ...b,
          [id]: `Contains ${describeCounts(data.counts)} — move or delete them first.`,
        }));
        return;
      }
      if (!res.ok) throw new Error();
      setRows((r) => r.filter((x) => x.id !== id));
      router.refresh();
    } catch {
      // no-op; the row stays
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-h2">Workspaces</h2>
      <p className="muted settings-desc">
        Workspaces partition all of your content — meetings, tasks, projects,
        people and notes. Switch between them from the sidebar. Each can have its
        own calendar feed.
      </p>

      <ul className="hidden-list">
        {rows.map((w) => (
          <li key={w.id} className="hidden-row">
            <div className="hidden-title" style={{ flex: 1, gap: "0.4rem" }}>
              <input
                type="text"
                defaultValue={w.name}
                aria-label="Workspace name"
                onBlur={(e) => patch(w.id, "name", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <input
                type="url"
                defaultValue={w.icsUrl ?? ""}
                aria-label="Calendar feed URL"
                placeholder="Published .ics feed URL (optional)"
                onBlur={(e) => patch(w.id, "icsUrl", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
              <WorkspaceCalendarPicker
                accounts={googleAccounts}
                accountId={w.googleAccountId}
                calendarId={w.googleCalendarId}
                onSave={(acc, cal) => saveGoogleCalendar(w.id, acc, cal)}
              />
              {blocked[w.id] && (
                <p className="login-error" style={{ margin: 0 }}>
                  {blocked[w.id]}
                </p>
              )}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.4rem 0.9rem",
                  marginTop: "0.15rem",
                }}
              >
                {WORKSPACE_FEATURES.map((f) => {
                  const enabled = !w.disabledFeatures.includes(f);
                  // "Calendar import" lives inside Meetings — disable its
                  // checkbox when Meetings is off.
                  const meetingsOn = !w.disabledFeatures.includes("meetings");
                  const locked = f === "calendar" && !meetingsOn;
                  return (
                    <label
                      key={f}
                      className="muted"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.3rem",
                        fontSize: "0.85rem",
                        opacity: locked ? 0.4 : 1,
                        cursor: locked ? "not-allowed" : "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={enabled}
                        disabled={locked}
                        onChange={() => toggleFeature(w.id, f)}
                      />
                      {FEATURE_LABELS[f]}
                    </label>
                  );
                })}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
              }}
            >
              {w.isDefault ? (
                <span className="nav-pill">Default</span>
              ) : (
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => remove(w.id)}
                >
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>

      <form
        onSubmit={add}
        style={{
          display: "flex",
          gap: "0.5rem",
          marginTop: "1rem",
        }}
      >
        <input
          type="text"
          value={newName}
          placeholder="New workspace name"
          onChange={(e) => setNewName(e.target.value)}
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          className="primary-btn"
          disabled={adding || newName.trim() === ""}
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </form>
    </section>
  );
}
