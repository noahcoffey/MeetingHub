"use client";

import Link from "next/link";
import { useState } from "react";
import { ProjectPicker, type ProjectOption } from "../project-picker";

// One inbox row — a meeting or a task with no project yet.
export type UntaggedInboxRow = {
  kind: "meeting" | "task";
  id: string;
  title: string;
  subLabel: string;
  suggested: ProjectOption | null;
};

const MeetingGlyph = () => (
  <svg
    className="ut-type"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden
  >
    <rect x="3" y="4.5" width="14" height="12" rx="2" />
    <path d="M3 8.5h14M7 2.8v3.4M13 2.8v3.4" />
  </svg>
);
const TaskGlyph = () => (
  <svg
    className="ut-type"
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    aria-hidden
  >
    <circle cx="10" cy="10" r="7" />
    <path d="M6.8 10.2l2.1 2.1 4.3-4.6" />
  </svg>
);

// "Needs a project" triage inbox: meetings and tasks interleaved, suggestion
// as a one-click accept, explicit dismiss, and a bulk accept-all header action.
export function UntaggedTriage({
  rows: initialRows,
  projects,
}: {
  rows: UntaggedInboxRow[];
  projects: ProjectOption[];
}) {
  const [rows, setRows] = useState(initialRows);

  function endpoint(row: UntaggedInboxRow): string {
    return row.kind === "meeting"
      ? `/api/meetings/${row.id}`
      : `/api/action-items/${row.id}`;
  }

  async function patchRow(
    row: UntaggedInboxRow,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      const res = await fetch(endpoint(row), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  // Optimistically remove the row; put it back if the PATCH fails.
  async function act(row: UntaggedInboxRow, body: Record<string, unknown>) {
    const prev = rows;
    setRows((r) => r.filter((x) => !(x.kind === row.kind && x.id === row.id)));
    if (!(await patchRow(row, body))) setRows(prev);
  }

  const tag = (row: UntaggedInboxRow, projectId: string | null) => {
    if (projectId) void act(row, { projectId });
  };
  const dismiss = (row: UntaggedInboxRow) =>
    act(row, { untaggedDismissed: true });

  const suggestedRows = rows.filter((r) => r.suggested !== null);

  async function acceptAll() {
    const prev = rows;
    const accepted = new Set(suggestedRows.map((r) => `${r.kind}:${r.id}`));
    setRows((r) => r.filter((x) => !accepted.has(`${x.kind}:${x.id}`)));
    const results = await Promise.all(
      suggestedRows.map((row) =>
        patchRow(row, { projectId: (row.suggested as ProjectOption).id }),
      ),
    );
    const failed = suggestedRows.filter((_, i) => !results[i]);
    if (failed.length > 0) {
      // Restore only what didn't stick.
      const failedKeys = new Set(failed.map((r) => `${r.kind}:${r.id}`));
      setRows((r) => [
        ...prev.filter((x) => failedKeys.has(`${x.kind}:${x.id}`)),
        ...r,
      ]);
    }
  }

  if (rows.length === 0) return null;

  return (
    <section className="untagged-triage">
      <h2 className="settings-h2">Needs a project</h2>
      <p className="muted settings-desc">
        Recent meetings and open tasks with no project yet. Accept the
        suggestion, pick a project, or dismiss with ✕ if it doesn&apos;t need
        one.
      </p>
      <div className="ut-panel">
        <div className="ut-head">
          <b>
            {rows.length} {rows.length === 1 ? "item" : "items"}
            {suggestedRows.length > 0 && (
              <small>
                {" "}
                · {suggestedRows.length} with{" "}
                {suggestedRows.length === 1 ? "a suggestion" : "suggestions"}
              </small>
            )}
          </b>
          {suggestedRows.length > 1 && (
            <button type="button" className="ut-bulk" onClick={acceptAll}>
              Accept all {suggestedRows.length} suggestions
            </button>
          )}
        </div>
        {rows.map((row) => (
          <div key={`${row.kind}:${row.id}`} className="ut-row">
            {row.kind === "meeting" ? <MeetingGlyph /> : <TaskGlyph />}
            <span className="ut-what">
              {row.kind === "meeting" ? (
                <Link href={`/meetings/${row.id}`} className="ut-title">
                  {row.title}
                </Link>
              ) : (
                <em>{row.title}</em>
              )}
              <small>{row.subLabel}</small>
            </span>
            <span className="ut-actions">
              {row.suggested && (
                <button
                  type="button"
                  className="ut-accept"
                  onClick={() => tag(row, (row.suggested as ProjectOption).id)}
                  title={`Tag as ${row.suggested.name}`}
                >
                  <i>✓</i> {row.suggested.name}
                </button>
              )}
              <ProjectPicker
                value={null}
                projects={projects}
                suggested={row.suggested}
                showSuggestedHint={false}
                onChange={(v) => tag(row, v)}
              />
              <button
                type="button"
                className="ut-skip"
                onClick={() => dismiss(row)}
                title="Doesn't need a project"
                aria-label="Dismiss — doesn't need a project"
              >
                ✕
              </button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
