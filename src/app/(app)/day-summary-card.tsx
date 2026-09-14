"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MarkdownView } from "./meetings/[id]/markdown-view";
import { MarkdownEditor } from "./meetings/[id]/markdown-editor";

export type DaySummaryCardData = {
  id: string | null;
  /** What renders: the hand-edited body when there is one. */
  body: string;
  /** The model's own output — offered alongside an edited body, and on reset. */
  generated: string;
  status: "none" | "generating" | "ready" | "failed";
  stale: boolean;
  edited: boolean;
  error: string | null;
  model: string | null;
  generatedAtLabel: string | null;
  /** Some meeting that day has manual or generated notes. */
  hasNotes: boolean;
  /** ANTHROPIC_API_KEY is set — without it, don't offer a button that can't work. */
  configured: boolean;
  meetingCount: number;
  totalTimeLabel: string;
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
// appendix. Nothing renders at all on a day with no notes: there is nothing to
// summarize, so offering to generate would only ever produce an error.
export function DaySummaryCard({
  date,
  data,
}: {
  date: string;
  data: DaySummaryCardData;
}) {
  const router = useRouter();
  // Local-only. Never seeded from props: router.refresh() re-renders this same
  // instance with new props but keeps state, so a seeded `busy`/`error` would
  // survive the very refresh that resolved it.
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [showGenerated, setShowGenerated] = useState(false);
  const [saving, setSaving] = useState(false);
  const draft = useRef(data.body);
  const running = useRef(false);

  const generate = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/day-summaries?date=${encodeURIComponent(date)}`,
        { method: "POST" },
      );
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        setError(payload?.error ?? "Generation failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("Generation failed.");
    } finally {
      setBusy(false);
      running.current = false;
    }
  }, [date, router]);

  // A reload that lands mid-generation shows "Generating…" from the stored
  // status; poll until the row settles, then pull the finished body in.
  useEffect(() => {
    if (data.status !== "generating") return;
    const id = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/day-summaries?date=${encodeURIComponent(date)}`,
        );
        if (!res.ok) return;
        const { status } = (await res.json()) as { status: string };
        if (status !== "generating") router.refresh();
      } catch {
        /* keep polling — a transient failure isn't a result */
      }
    }, 5000);
    return () => clearInterval(id);
  }, [data.status, date, router]);

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
      setEditing(false);
      setShowGenerated(false);
      router.refresh();
    } catch {
      setError("Could not save your edit.");
    } finally {
      setSaving(false);
    }
  }

  // §9 — a day with nothing to summarize gets no card and no generate action.
  if (!data.hasNotes && data.status === "none") return null;

  const generating = busy || data.status === "generating";
  // A failure recorded on the server (e.g. the tab was closed mid-generation)
  // is just as real as one this component saw happen.
  const shownError = error ?? (data.status === "failed" ? data.error : null);

  return (
    <section className="day-summary" aria-label="Day summary">
      <div className="day-summary-head">
        <h2 className="day-summary-title">
          <SparkIcon />
          Day summary
        </h2>
        <div className="day-summary-actions">
          {data.stale && !generating && (
            <span className="badge day-summary-stale" title="Notes changed after this summary was written">
              Inputs changed
            </span>
          )}
          {data.edited && !generating && (
            <span className="badge" title="You edited this summary by hand">
              Edited
            </span>
          )}
          {data.status !== "none" && !editing && !generating && (
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
          {data.edited && !editing && !generating && (
            <button
              type="button"
              className="row-action"
              onClick={() => setShowGenerated((s) => !s)}
            >
              {showGenerated ? "Hide original" : "View original"}
            </button>
          )}
          {data.configured && !editing && (
            <button
              type="button"
              className={data.status === "none" ? "primary-btn" : "ghost-btn ghost-btn-sm"}
              onClick={() => void generate()}
              disabled={generating || !data.hasNotes}
            >
              {generating
                ? "Generating…"
                : data.status === "none"
                  ? "Generate day summary"
                  : "Regenerate"}
            </button>
          )}
        </div>
      </div>

      {shownError && <p className="day-summary-error">{shownError}</p>}

      {data.stale && !generating && (
        // §6 — never silently regenerate. Show what's stored, say the inputs
        // moved, and let the reader decide.
        <p className="muted day-summary-note">
          Notes for this day changed after this summary was written.
        </p>
      )}

      {generating ? (
        <p className="muted day-summary-note">
          Reading the day&rsquo;s notes and writing the summary — this takes a
          minute.
        </p>
      ) : data.status === "none" ? (
        <p className="muted day-summary-note">
          {data.configured
            ? `${data.meetingCount} meeting${data.meetingCount === 1 ? "" : "s"} with notes${data.totalTimeLabel ? ` · ${data.totalTimeLabel}` : ""} — not summarized yet.`
            : "Day summaries aren’t configured on this server (ANTHROPIC_API_KEY is unset)."}
        </p>
      ) : editing ? (
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

      {data.status === "ready" && data.generatedAtLabel && !editing && (
        <p className="day-summary-meta muted">
          Generated {data.generatedAtLabel}
          {data.model ? ` · ${data.model}` : ""}
        </p>
      )}
    </section>
  );
}
