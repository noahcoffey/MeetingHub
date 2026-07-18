"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function NewProjectForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), deadline: deadline || null }),
      });
      if (!res.ok) throw new Error("create failed");
      const { item } = await res.json();
      router.push(`/projects/${item.id}`);
    } catch {
      setError("Could not create project. Try again.");
      setSaving(false);
    }
  }

  return (
    <div className="new-meeting" ref={wrapRef}>
      <button
        type="button"
        className={`primary-btn new-meeting-trigger ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        + New project
      </button>

      {open && (
        <form className="new-meeting-form" onSubmit={submit}>
          <input
            type="text"
            placeholder="Project name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            aria-label="Deadline (optional)"
          />
          <div className="new-meeting-actions">
            <button type="submit" className="primary-btn" disabled={saving}>
              {saving ? "Creating…" : "Create"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
          {error && <p className="login-error">{error}</p>}
        </form>
      )}
    </div>
  );
}
