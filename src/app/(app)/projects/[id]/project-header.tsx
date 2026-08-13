"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "../../confirm-dialog";
import type { ProjectStatus } from "@/db/schema";

export type ProjectHeaderData = {
  id: string;
  name: string;
  description: string;
  deadline: string | null; // YYYY-MM-DD
  status: ProjectStatus;
};

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA").format(new Date());
}

function formatDeadline(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(dt);
}

// Whole calendar days from today to the deadline (negative = past due).
function daysUntil(deadline: string): number {
  const [y, m, d] = deadline.split("-").map(Number);
  const [ty, tm, td] = todayIso().split("-").map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

function countdownLabel(deadline: string): string {
  const days = daysUntil(deadline);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days} days`;
  return days === -1 ? "1 day overdue" : `${-days} days overdue`;
}

export function ProjectHeader({
  project,
  openTaskCount,
  overdueTaskCount = 0,
  doneTaskCount = 0,
  nextMeetingLabel,
}: {
  project: ProjectHeaderData;
  openTaskCount: number;
  overdueTaskCount?: number;
  doneTaskCount?: number;
  nextMeetingLabel: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [deadline, setDeadline] = useState(project.deadline ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description,
          deadline: deadline || null,
        }),
      });
      if (!res.ok) throw new Error();
      setEditing(false);
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchive() {
    const nextStatus = project.status === "active" ? "archived" : "active";
    await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: nextStatus }),
    });
    router.refresh();
  }

  async function remove() {
    await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
    router.push("/projects");
  }

  if (editing) {
    return (
      <form className="detail-header project-edit-form" onSubmit={save}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          required
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          rows={3}
        />
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          aria-label="Deadline"
        />
        <div className="new-meeting-actions">
          <button type="submit" className="primary-btn" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <header className="detail-header">
      <div className="detail-title-row">
        <h1 className="page-title">
          {project.name}
          {project.status === "archived" && <span className="badge hub-archived-badge">Archived</span>}
          {project.status === "parked" && <span className="badge hub-parked-badge">Parked</span>}
        </h1>
        <div className="detail-title-actions">
          <button type="button" className="row-action" onClick={() => setEditing(true)}>
            Edit
          </button>
          <button type="button" className="row-action" onClick={toggleArchive}>
            {project.status === "active"
              ? "Archive"
              : project.status === "parked"
                ? "Promote"
                : "Reactivate"}
          </button>
          <button
            type="button"
            className="row-action danger"
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </button>
        </div>
      </div>
      {project.description.trim() && <p className="muted">{project.description}</p>}
      <p className="muted hub-meta-line">
        {openTaskCount === 0 ? "No open tasks" : `${openTaskCount} open task${openTaskCount === 1 ? "" : "s"}`}
        {overdueTaskCount > 0 && (
          <>
            {" · "}
            <span className="overdue">{overdueTaskCount} overdue</span>
          </>
        )}
        {project.deadline && (
          <>
            {" · due "}
            <span className={project.status === "active" && project.deadline < todayIso() ? "overdue" : ""}>
              {formatDeadline(project.deadline)}
            </span>
            {project.status === "active" && (
              <span
                className={`hub-countdown ${project.deadline < todayIso() ? "overdue" : ""}`}
              >
                {" "}
                ({countdownLabel(project.deadline)})
              </span>
            )}
          </>
        )}
        {nextMeetingLabel && <> · next: {nextMeetingLabel}</>}
      </p>
      {openTaskCount + doneTaskCount > 0 && (
        <div className="hub-progress">
          <div className="progress-track">
            <div
              className="progress-fill done-fill"
              style={{
                width: `${Math.round((doneTaskCount / (openTaskCount + doneTaskCount)) * 100)}%`,
              }}
            />
          </div>
          <span className="hub-progress-label">
            {doneTaskCount} of {openTaskCount + doneTaskCount} tasks done ·{" "}
            {Math.round((doneTaskCount / (openTaskCount + doneTaskCount)) * 100)}%
          </span>
        </div>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this project?"
        message="Meetings and action items tagged to it will be detached, not deleted. This can't be undone."
        confirmLabel="Delete project"
        danger
        onConfirm={() => {
          setConfirmDelete(false);
          void remove();
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </header>
  );
}
