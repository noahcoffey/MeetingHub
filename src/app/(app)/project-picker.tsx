"use client";

import { useEffect, useRef, useState } from "react";

export type ProjectOption = { id: string; name: string };

const FolderIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
    <path
      d="M3.5 6a1 1 0 011-1h4l1.5 1.5H15a1 1 0 011 1V14a1 1 0 01-1 1H4.5a1 1 0 01-1-1V6z"
      strokeWidth="1.5"
      strokeLinejoin="round"
    />
  </svg>
);

// A one-click project tag, structured like the DueDatePopover in action-items-list.tsx:
// trigger pill + a floating list, closes on outside click / Escape.
export function ProjectPicker({
  value,
  projects,
  onChange,
  suggested = null,
  showLabel = true,
  showSuggestedHint = true,
}: {
  value: string | null;
  projects: ProjectOption[];
  onChange: (projectId: string | null) => void;
  // Pre-highlighted row from a fuzzy name match — a one-click accept, never forced.
  suggested?: ProjectOption | null;
  // When false, a set project only recolors the icon — no name pill. Keeps dense
  // list rows (action items) narrow; the meeting header still shows the name.
  showLabel?: boolean;
  // When false, no "Name?" pill on the trigger — for rows that surface the
  // suggestion as their own accept button (the Projects triage inbox).
  showSuggestedHint?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrapRef = useRef<HTMLSpanElement>(null);
  const current = value ? (projects.find((p) => p.id === value) ?? null) : null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = filter.trim()
    ? projects.filter((p) =>
        p.name.toLowerCase().includes(filter.trim().toLowerCase()),
      )
    : projects;

  return (
    <span className="project-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`project-trigger ${current ? "has-project" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={current ? current.name : suggested ? `Tag as ${suggested.name}?` : "Set project"}
        aria-label={current ? current.name : "Set project"}
      >
        <FolderIcon />
        {showLabel && current && <span className="project-pill">{current.name}</span>}
        {!current && suggested && showSuggestedHint && (
          <span className="project-pill project-suggested">{suggested.name}?</span>
        )}
      </button>
      {open && (
        <div className="project-popover" role="dialog">
          <input
            type="text"
            placeholder="Filter projects…"
            value={filter}
            autoFocus
            onChange={(e) => setFilter(e.target.value)}
          />
          <ul className="project-options">
            {filtered.length === 0 && <li className="project-empty">No projects</li>}
            {filtered.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={`project-option ${p.id === value ? "is-selected" : ""}`}
                  onClick={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
          {value && (
            <button
              type="button"
              className="project-clear"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </span>
  );
}
