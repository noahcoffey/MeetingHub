"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MarkdownView } from "./meetings/[id]/markdown-view";
import { MarkdownEditor } from "./meetings/[id]/markdown-editor";

export type DaySummaryCardData = {
  id: string | null;
  /** What renders: the hand-edited body when there is one. */
  body: string;
  /** The runner's output — offered alongside an edited body, and on reset. */
  generated: string;
  stale: boolean;
  edited: boolean;
  model: string | null;
  generatedAtLabel: string | null;
};

function SparkIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M10 3.5l1.6 3.9 3.9 1.6-3.9 1.6L10 14.5l-1.6-3.9L4.5 9l3.9-1.6L10 3.5z"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// The day's synthesis, at the top of the day view — it's the lead, not an
// appendix. Read-only apart from hand edits: summaries are written by the local
// runner (tools/day-summary) and pushed in, so there is nothing to trigger from
// here. Nothing renders at all until a summary exists for the day.
export function DaySummaryCard({ data }: { data: DaySummaryCardData }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showGenerated, setShowGenerated] = useState(false);
  const [saving, setSaving] = useState(false);
  const draft = useRef(data.body);

  async function saveEdit(markdown: string | null) {
    if (!data.id) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/day-summaries/${data.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ markdown }),
      });
      if (!res.ok) {
        setError("Could not save your edit.");
        return;
      }
      setError(null);
      setEditing(false);
      setShowGenerated(false);
      router.refresh();
    } catch {
      setError("Could not save your edit.");
    } finally {
      setSaving(false);
    }
  }

  const hasSummary = !!data.id;
  // No summary, nothing to say: the card is the summary, not a placeholder for
  // one. The nightly runner writes it; an empty box only adds noise.
  if (!hasSummary) return null;

  return (
    <section className="day-summary" aria-label="Day summary">
      <div className="day-summary-head">
        <h2 className="day-summary-title">
          <SparkIcon />
          Day summary
        </h2>
        <div className="day-summary-actions">
          {data.stale && (
            <span
              className="badge day-summary-stale"
              title="Notes changed after this summary was written"
            >
              Inputs changed
            </span>
          )}
          {data.edited && <span className="badge">Edited</span>}
          {!editing && (
            <button
              type="button"
              className="row-action"
              onClick={() => {
                draft.current = data.body;
                setEditing(true);
              }}
            >
              Edit
            </button>
          )}
          {data.edited && !editing && (
            <button
              type="button"
              className="row-action"
              onClick={() => setShowGenerated((s) => !s)}
            >
              {showGenerated ? "Hide original" : "View original"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="day-summary-error">{error}</p>}

      {data.stale && (
        // Flagged, never silently rewritten: re-run the runner for this day if
        // the summary should catch up.
        <p className="muted day-summary-note">
          Notes for this day changed after this summary was written.
        </p>
      )}

      {editing ? (
        <div className="day-summary-edit">
          <MarkdownEditor
            initialMarkdown={data.body}
            onChange={(md) => {
              draft.current = md;
            }}
          />
          <div className="day-summary-edit-actions">
            <button
              type="button"
              className="primary-btn"
              disabled={saving}
              onClick={() => void saveEdit(draft.current)}
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              className="ghost-btn ghost-btn-sm"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
            {data.edited && (
              <button
                type="button"
                className="row-action danger"
                disabled={saving}
                onClick={() => void saveEdit(null)}
                title="Discard your edits and go back to the generated summary"
              >
                Reset to generated
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <MarkdownView markdown={data.body} />
          {showGenerated && (
            <div className="day-summary-original">
              <p className="muted day-summary-note">Generated original</p>
              <MarkdownView markdown={data.generated} />
            </div>
          )}
        </>
      )}

      {data.generatedAtLabel && !editing && (
        <p className="day-summary-meta muted">
          Generated {data.generatedAtLabel}
          {data.model ? ` · ${data.model}` : ""}
        </p>
      )}
    </section>
  );
}
