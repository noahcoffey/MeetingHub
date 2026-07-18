"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function NewPersonForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? "create failed");
      }
      const { person } = await res.json();
      router.push(`/people/${person.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create person.");
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
        + New person
      </button>

      {open && (
        <form className="new-meeting-form" onSubmit={submit}>
          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
            required
          />
          <input
            type="email"
            placeholder="Email (matches meeting attendees)"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
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
