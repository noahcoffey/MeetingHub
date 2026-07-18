"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Build a datetime-local default (YYYY-MM-DDTHH:mm) for the viewed date.
function defaultStart(dateStr: string): string {
  const now = new Date();
  const todayStr = new Intl.DateTimeFormat("en-CA").format(now);
  if (dateStr === todayStr) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${dateStr}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  }
  return `${dateStr}T09:00`;
}

export function NewMeetingForm({ defaultDate }: { defaultDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [start, setStart] = useState(() => defaultStart(defaultDate));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close the popover on outside click or Escape (unless mid-save).
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

  // Open when triggered by the `n` keyboard shortcut (event when already here,
  // or a one-shot flag set just before navigating to this page).
  useEffect(() => {
    function open() {
      setOpen(true);
    }
    window.addEventListener("mh:new-meeting", open);
    try {
      if (sessionStorage.getItem("mh:new-meeting") === "1") {
        sessionStorage.removeItem("mh:new-meeting");
        setOpen(true);
      }
    } catch {
      /* ignore */
    }
    return () => window.removeEventListener("mh:new-meeting", open);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          startTime: new Date(start).toISOString(),
        }),
      });
      if (!res.ok) throw new Error("create failed");
      const { meeting } = await res.json();
      router.push(`/meetings/${meeting.id}`);
    } catch {
      setError("Could not create meeting. Try again.");
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
        + New meeting
      </button>

      {open && (
        <form className="new-meeting-form" onSubmit={submit}>
          <input
            type="text"
            placeholder="Meeting title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            required
          />
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
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
