"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MHMark } from "../mh-mark";

export type WorkspaceOption = { id: string; name: string };

function CaretIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M6 8l4 4 4-4"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M4.5 10.5l3.5 3.5 7.5-8"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The MH mark in the sidebar top-left doubles as the workspace switcher:
// clicking it lists all workspaces and jumps to the dashboard on switch (the
// current route likely belongs to the old workspace, so a full navigation is
// the only always-correct landing).
export function WorkspaceSwitcher({
  workspaces,
  activeId,
}: {
  workspaces: WorkspaceOption[];
  activeId: string;
}) {
  const [open, setOpen] = useState(false);
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const active = workspaces.find((w) => w.id === activeId);

  async function switchTo(id: string) {
    if (id === activeId || switchingId) {
      setOpen(false);
      return;
    }
    setSwitchingId(id);
    try {
      const res = await fetch("/api/workspaces/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (res.ok) {
        window.location.assign("/");
        return;
      }
    } catch {
      // fall through to reset
    }
    setSwitchingId(null);
  }

  return (
    <div className="workspace-switch" ref={wrapRef}>
      <button
        type="button"
        className="brand-button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Switch workspace"
      >
        <span className="brand-mark">
          <MHMark width={18} />
        </span>
        <span className="brand-name">{active?.name ?? "Meeting Hub"}</span>
        <span className="brand-caret">
          <CaretIcon />
        </span>
      </button>
      {open && (
        <div className="workspace-menu" role="menu">
          <ul className="workspace-options">
            {workspaces.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={w.id === activeId}
                  className={
                    w.id === activeId
                      ? "workspace-option is-active"
                      : "workspace-option"
                  }
                  onClick={() => switchTo(w.id)}
                  disabled={switchingId !== null && switchingId !== w.id}
                >
                  <span className="workspace-option-name">{w.name}</span>
                  {w.id === activeId && (
                    <span className="workspace-option-check">
                      <CheckIcon />
                    </span>
                  )}
                  {switchingId === w.id && (
                    <span className="workspace-option-check">…</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <div className="workspace-menu-divider" />
          <Link
            href="/settings/workspaces"
            className="workspace-manage-link"
            onClick={() => setOpen(false)}
          >
            Manage workspaces…
          </Link>
        </div>
      )}
    </div>
  );
}
