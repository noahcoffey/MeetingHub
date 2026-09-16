"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Overlay } from "../../confirm-dialog";

// Private/Public switch for a single note. "Public" mints an unguessable
// /s/<slug> URL that renders the note and nothing else; going back to Private
// clears the slug, so the old link stops working for good (re-sharing produces
// a different one). The parent passes the current slug from the server.
export function ShareNoteButton({
  noteId,
  initialSlug,
}: {
  noteId: string;
  initialSlug: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState(initialSlug);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  // window isn't available during SSR; the URL is only shown once mounted.
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const shareUrl = slug ? `${origin}/s/${slug}` : "";

  async function setShared(next: boolean) {
    if (busy || next === !!slug) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/notes/${noteId}/share`, {
        method: next ? "POST" : "DELETE",
      });
      if (!res.ok) throw new Error("request failed");
      const data = (await res.json()) as { shareSlug: string | null };
      setSlug(data.shareSlug);
      setCopied(false);
      // Keeps the /notes list badge in step.
      router.refresh();
    } catch {
      setError("Couldn't update sharing. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setError("Couldn't copy — select the link and copy it manually.");
    }
  }

  return (
    <>
      <button
        type="button"
        className="share-btn"
        onClick={() => setOpen(true)}
        aria-label="Share note"
      >
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
          <circle cx="15" cy="5" r="2.2" strokeWidth="1.5" />
          <circle cx="5" cy="10" r="2.2" strokeWidth="1.5" />
          <circle cx="15" cy="15" r="2.2" strokeWidth="1.5" />
          <path d="M7 8.9 13 6.1M7 11.1 13 13.9" strokeWidth="1.5" />
        </svg>
        {slug ? "Shared" : "Share"}
      </button>

      {open && (
        <Overlay onClose={() => setOpen(false)}>
          <div className="modal-body">
            <h2 className="modal-title">Share this note</h2>
            <div className="share-options">
              <label className="share-option">
                <input
                  type="radio"
                  name="note-visibility"
                  checked={!slug}
                  disabled={busy}
                  onChange={() => setShared(false)}
                />
                <span>
                  <strong>Private</strong>
                  <em>Only you, signed in to Meeting Hub.</em>
                </span>
              </label>
              <label className="share-option">
                <input
                  type="radio"
                  name="note-visibility"
                  checked={!!slug}
                  disabled={busy}
                  onChange={() => setShared(true)}
                />
                <span>
                  <strong>Public link</strong>
                  <em>
                    Anyone with the link can read this note — just this note,
                    nothing else in Meeting Hub.
                  </em>
                </span>
              </label>
            </div>

            {slug && (
              <div className="share-url-row">
                <input
                  className="modal-input share-url"
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button type="button" className="ghost-btn" onClick={copy}>
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
            <p className="modal-message share-note-hint">
              {slug
                ? "Switching back to Private turns this link off permanently — sharing again creates a new one."
                : "Sharing creates a link nobody can guess. It stays live until you switch back to Private."}
            </p>
            {error && <p className="share-error">{error}</p>}
          </div>
          <div className="modal-actions">
            <button type="button" className="primary-btn" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </Overlay>
      )}
    </>
  );
}
