"use client";

import { useState } from "react";
import Link from "next/link";
import { MarkdownView } from "./markdown-view";

export type PastItem = {
  id: string;
  dateLabel: string;
  timeLabel: string;
  hasNotes: boolean;
  hasGenerated: boolean;
};

type Body =
  | { notes: string; notesGenerated: string | null }
  | "loading"
  | "error";

// Title-area tab that opens an accordion of earlier same-titled meetings. Each
// row lazy-loads that meeting's notes when expanded.
export function PastMeetings({
  title,
  items,
  hideGenerated = false,
}: {
  title: string;
  items: PastItem[];
  // Advanced setting: suppress generated notes in the expanded bodies
  // (the Notes+ badges are already off via items[].hasGenerated).
  hideGenerated?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [bodies, setBodies] = useState<Record<string, Body>>({});

  async function toggleItem(id: string) {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    if (!bodies[id]) {
      setBodies((b) => ({ ...b, [id]: "loading" }));
      try {
        const res = await fetch(`/api/meetings/${id}`);
        if (!res.ok) throw new Error();
        const data = await res.json();
        setBodies((b) => ({
          ...b,
          [id]: {
            notes: data.meeting?.notes ?? "",
            notesGenerated: data.meeting?.notesGenerated ?? null,
          },
        }));
      } catch {
        setBodies((b) => ({ ...b, [id]: "error" }));
      }
    }
  }

  return (
    <>
      <button
        type="button"
        className="pm-tab"
        onClick={() => setOpen(true)}
        disabled={items.length === 0}
        title={
          items.length
            ? `${items.length} earlier meeting${items.length === 1 ? "" : "s"} with this title`
            : "No earlier meetings with this title yet"
        }
      >
        Past meetings{items.length ? ` (${items.length})` : ""}
      </button>

      {open && (
        <div className="pm-panel">
          <div className="pm-panel-head">
            <span className="pm-panel-title">Past meetings · {title}</span>
            <button
              type="button"
              className="pm-close"
              onClick={() => setOpen(false)}
              aria-label="Close past meetings"
            >
              ✕
            </button>
          </div>
          <div className="pm-list">
            {items.length === 0 && (
              <p className="ai-empty">No earlier meetings with this title.</p>
            )}
            {items.map((it) => {
              const expanded = openId === it.id;
              const body = bodies[it.id];
              return (
                <div className={`pm-item ${expanded ? "open" : ""}`} key={it.id}>
                  <button
                    type="button"
                    className="pm-item-head"
                    onClick={() => toggleItem(it.id)}
                    aria-expanded={expanded}
                  >
                    <svg
                      className="pm-chevron"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      aria-hidden
                    >
                      <path
                        d="M7 5l5 5-5 5"
                        strokeWidth="1.7"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="pm-date">{it.dateLabel}</span>
                    <span className="pm-time">{it.timeLabel}</span>
                    {it.hasGenerated ? (
                      <span className="badge badge-notes-plus">Notes+</span>
                    ) : it.hasNotes ? (
                      <span className="badge">Notes</span>
                    ) : null}
                  </button>
                  {expanded && (
                    <div className="pm-item-body">
                      {body === "loading" && <p className="muted">Loading…</p>}
                      {body === "error" && (
                        <p className="muted">Couldn’t load these notes.</p>
                      )}
                      {body && body !== "loading" && body !== "error" && (
                        <>
                          {body.notes.trim() ? (
                            <MarkdownView markdown={body.notes} />
                          ) : (
                            <p className="muted">No notes for this meeting.</p>
                          )}
                          {!hideGenerated && body.notesGenerated && body.notesGenerated.trim() && (
                            <div className="pm-generated">
                              <div className="pm-generated-label">
                                Generated notes
                              </div>
                              <MarkdownView markdown={body.notesGenerated} />
                            </div>
                          )}
                          <Link
                            href={`/meetings/${it.id}`}
                            className="pm-open-link"
                          >
                            Open this meeting →
                          </Link>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
