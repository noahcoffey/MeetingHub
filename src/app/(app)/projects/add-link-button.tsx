"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Overlay } from "../confirm-dialog";

// "Add link" for the overview Links card: opens a small modal (URL + optional
// label), POSTs to /api/project-links, and refreshes the server-rendered list.
export function AddLinkButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => urlRef.current?.focus(), 10);
    return () => clearTimeout(id);
  }, [open]);

  function close() {
    if (saving) return;
    setOpen(false);
    setUrl("");
    setLabel("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/project-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          url: url.trim(),
          label: label.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add link");
      setSaving(false);
      setOpen(false);
      setUrl("");
      setLabel("");
      router.refresh();
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Could not add link");
    }
  }

  return (
    <>
      <button
        type="button"
        className="ghost-btn ghost-btn-sm"
        onClick={() => setOpen(true)}
      >
        + Add link
      </button>
      {open && (
        <Overlay onClose={close}>
          <form className="modal-form" onSubmit={submit}>
            <div className="modal-body">
              <h2 className="modal-title">Add link</h2>
              <input
                ref={urlRef}
                className="modal-input"
                type="url"
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                aria-label="Link URL"
              />
              <input
                className="modal-input"
                type="text"
                placeholder="Label (optional)"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                aria-label="Link label"
              />
              {error && <p className="login-error">{error}</p>}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost-btn"
                onClick={close}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="primary-btn"
                disabled={saving || !url.trim()}
              >
                {saving ? "Adding…" : "Add link"}
              </button>
            </div>
          </form>
        </Overlay>
      )}
    </>
  );
}
