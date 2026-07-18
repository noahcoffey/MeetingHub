"use client";

import { useState } from "react";
import { detectLinkType, LINK_TYPE_LABEL } from "@/lib/link-type";
import { LinkTypeIcon } from "./link-icon";

export type ProjectLinkItem = { id: string; url: string; label: string | null };

export function ProjectLinks({
  projectId,
  initialLinks,
}: {
  projectId: string;
  initialLinks: ProjectLinkItem[];
}) {
  const [links, setLinks] = useState(initialLinks);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addLink(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/project-links", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, url: url.trim(), label: label.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add link");
      setLinks((prev) => [...prev, data.link]);
      setUrl("");
      setLabel("");
      setAdding(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add link");
    } finally {
      setSaving(false);
    }
  }

  async function removeLink(id: string) {
    const prev = links;
    setLinks((ls) => ls.filter((l) => l.id !== id));
    try {
      const res = await fetch(`/api/project-links/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setLinks(prev);
    }
  }

  return (
    <div className="project-links">
      {links.length === 0 && !adding && <p className="muted empty-sm">No links yet.</p>}

      {links.length > 0 && (
        <ul className="link-list">
          {links.map((l) => {
            const type = detectLinkType(l.url);
            return (
              <li key={l.id} className="link-row">
                <a
                  href={l.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-anchor"
                  title={LINK_TYPE_LABEL[type]}
                >
                  <span className="link-icon">
                    <LinkTypeIcon type={type} />
                  </span>
                  <span className="link-text">{l.label || l.url}</span>
                </a>
                <button
                  type="button"
                  className="link-remove"
                  aria-label="Remove link"
                  onClick={() => removeLink(l.id)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {adding ? (
        <form className="link-add-form" onSubmit={addLink}>
          <input
            type="url"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoFocus
            required
          />
          <input
            type="text"
            placeholder="Label (optional)"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
          <div className="new-meeting-actions">
            <button type="submit" className="primary-btn" disabled={saving || !url.trim()}>
              {saving ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => {
                setAdding(false);
                setError(null);
              }}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
          {error && <p className="login-error">{error}</p>}
        </form>
      ) : (
        <button type="button" className="row-action" onClick={() => setAdding(true)}>
          + Add link
        </button>
      )}
    </div>
  );
}
