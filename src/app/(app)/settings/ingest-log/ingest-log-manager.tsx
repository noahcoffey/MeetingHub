"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

export type IngestLogItem = {
  id: string;
  receivedAt: string;
  sourceId: string;
  title: string | null;
  when: string | null;
  defaultDate: string;
  workspaceLabel: string | null;
  outcome: "matched_written" | "matched_not_written" | "pending";
  reassigned: boolean;
  stillPending: boolean;
  meeting: {
    id: string;
    title: string;
    when: string;
    skipped: boolean;
    hidden: boolean;
    workspaceId: string;
    workspaceName: string | null;
    holdsBody: boolean;
    hasGenerated: boolean;
  } | null;
  matchedMeeting: { id: string; title: string } | null;
  preview: string;
};

type Workspace = { id: string; name: string };

export function IngestLogManager({
  initial,
  limit,
  workspaces,
  activeWorkspaceId,
}: {
  initial: IngestLogItem[];
  limit: number;
  workspaces: Workspace[];
  activeWorkspaceId: string;
}) {
  return (
    <section className="settings-section">
      <h2 className="settings-h2">Ingest log</h2>
      <p className="muted settings-desc">
        Every push received by the ingest API, newest first (last {limit}), and the
        meeting each one landed on. If notes went to the wrong meeting — a skipped
        or hidden one is the usual culprit — re-associate them here: the notes are
        moved from the log itself, so this works even when the push was dropped
        because the matched meeting already had notes.{" "}
        <a href="/api-docs.html#ingest" target="_blank" rel="noopener noreferrer">
          Ingest API documentation ↗
        </a>
      </p>
      {initial.length === 0 ? (
        <p className="muted empty-sm">Nothing received yet.</p>
      ) : (
        <ul className="incoming-list">
          {initial.map((it) => (
            <IngestLogRow
              key={it.id}
              item={it}
              workspaces={workspaces}
              activeWorkspaceId={activeWorkspaceId}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function outcomeLabel(item: IngestLogItem): string {
  switch (item.outcome) {
    case "matched_written":
      return "Matched · notes written";
    case "matched_not_written":
      return "Matched · not written (meeting already had notes)";
    case "pending":
      return item.meeting
        ? "No match · resolved from Incoming"
        : item.stillPending
          ? "No match · waiting in Incoming"
          : "No match · discarded";
  }
}

function IngestLogRow({
  item,
  workspaces,
  activeWorkspaceId,
}: {
  item: IngestLogItem;
  workspaces: Workspace[];
  activeWorkspaceId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function post(body: object) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/ingest-events/${item.id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as {
        meetingId?: string;
        error?: string;
      };
      if (!res.ok) {
        setError(
          data.error === "target-occupied"
            ? "That meeting already has generated notes. Clear them first, or pick another."
            : data.error === "same-meeting"
              ? "Already associated with that meeting."
              : "Couldn’t re-associate. Try again.",
        );
        return;
      }
      setDone(data.meetingId ?? null);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Couldn’t re-associate. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const m = item.meeting;

  return (
    <li className="incoming-row ingest-row">
      <div className="incoming-head">
        <div className="incoming-meta">
          <div className="incoming-title">
            {item.title ?? <span className="muted">(no title sent)</span>}
          </div>
          <div className="incoming-when">
            Received {item.receivedAt}
            {item.when && <> · meeting time {item.when}</>}
            {item.workspaceLabel && <> · {item.workspaceLabel}</>}
          </div>
          <div className="incoming-when ingest-source">
            sourceId <code>{item.sourceId}</code>
          </div>
        </div>
        <div className="incoming-actions">
          <button
            type="button"
            className="ghost-btn"
            disabled={busy}
            onClick={() => setOpen((v) => !v)}
          >
            Re-associate…
          </button>
        </div>
      </div>

      <div className="ingest-outcome">
        <span className={`ingest-pill is-${item.outcome}`}>{outcomeLabel(item)}</span>
        {item.reassigned && <span className="ingest-pill is-reassigned">Re-associated</span>}
      </div>

      {m ? (
        <div className="ingest-target">
          <span className="muted">Now on</span>{" "}
          <Link href={`/meetings/${m.id}`}>{m.title}</Link>
          <span className="muted"> · {m.when}</span>
          {m.workspaceName && <span className="muted"> · {m.workspaceName}</span>}
          {m.skipped && <span className="ingest-flag is-warn">Skipped</span>}
          {m.hidden && <span className="ingest-flag is-warn">Hidden title</span>}
          {!m.holdsBody && (
            <span
              className="ingest-flag"
              title={
                m.hasGenerated
                  ? "The meeting's generated notes differ from this push (edited, or from another push)."
                  : "The meeting has no generated notes."
              }
            >
              {m.hasGenerated ? "Notes differ" : "Notes absent"}
            </span>
          )}
          {item.matchedMeeting && (
            <div className="muted ingest-orig">
              Originally landed on{" "}
              <Link href={`/meetings/${item.matchedMeeting.id}`}>
                {item.matchedMeeting.title}
              </Link>
            </div>
          )}
        </div>
      ) : item.stillPending ? (
        <div className="ingest-target muted">
          Not associated yet — <Link href="/settings/incoming">review in Incoming</Link>,
          or re-associate here.
        </div>
      ) : item.outcome === "pending" ? (
        <div className="ingest-target muted">
          Not associated — discarded from Incoming, or the meeting was later deleted.
          The notes are still here; re-associate to place them.
        </div>
      ) : (
        <div className="ingest-target muted">The matched meeting no longer exists.</div>
      )}

      {done && (
        <div className="ingest-done">
          Moved. <Link href={`/meetings/${done}`}>Open the meeting →</Link>
        </div>
      )}

      <details className="incoming-preview">
        <summary>Preview notes as received</summary>
        <pre>{item.preview}</pre>
      </details>

      {open && (
        <ReassociatePicker
          item={item}
          workspaces={workspaces}
          initialWorkspaceId={m?.workspaceId ?? activeWorkspaceId}
          busy={busy}
          error={error}
          onMatch={(meetingId) => post({ action: "match", meetingId })}
          onCreate={(workspaceId) => post({ action: "create", workspaceId })}
        />
      )}
    </li>
  );
}

function ReassociatePicker({
  item,
  workspaces,
  initialWorkspaceId,
  busy,
  error,
  onMatch,
  onCreate,
}: {
  item: IngestLogItem;
  workspaces: Workspace[];
  initialWorkspaceId: string;
  busy: boolean;
  error: string | null;
  onMatch: (meetingId: string) => void;
  onCreate: (workspaceId: string) => void;
}) {
  const [workspaceId, setWorkspaceId] = useState(initialWorkspaceId);
  const [date, setDate] = useState(item.defaultDate);
  const [meetings, setMeetings] = useState<{ id: string; label: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!date) return;
    let cancelled = false;
    setLoading(true);
    setSelected("");
    setMeetings([]);
    fetch(
      `/api/meetings?date=${date}&workspace=${encodeURIComponent(workspaceId)}`,
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data) => {
        if (cancelled) return;
        setMeetings(
          (data.meetings ?? [])
            .filter((m: { id: string }) => m.id !== item.meeting?.id)
            .map((m: { id: string; title: string; startTime: string }) => ({
              id: m.id,
              label: `${new Date(m.startTime).toLocaleTimeString([], {
                hour: "numeric",
                minute: "2-digit",
              })} — ${m.title}`,
            })),
        );
      })
      .catch(() => {
        if (!cancelled) setMeetings([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [date, workspaceId, item.meeting?.id]);

  return (
    <div className="incoming-match ingest-match">
      {workspaces.length > 1 && (
        <select
          value={workspaceId}
          aria-label="Workspace"
          onChange={(e) => setWorkspaceId(e.target.value)}
        >
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      )}
      <input
        type="date"
        value={date}
        aria-label="Date of the target meeting"
        onChange={(e) => setDate(e.target.value)}
      />
      <select
        value={selected}
        aria-label="Target meeting"
        onChange={(e) => setSelected(e.target.value)}
      >
        <option value="">
          {loading
            ? "Loading…"
            : meetings.length === 0
              ? "No other meetings that day"
              : "Select a meeting…"}
        </option>
        {meetings.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="primary-btn"
        disabled={!selected || busy}
        onClick={() => onMatch(selected)}
      >
        Move notes
      </button>
      <button
        type="button"
        className="ghost-btn"
        disabled={busy}
        title="Create a new meeting from the push's title and time and move the notes there"
        onClick={() => onCreate(workspaceId)}
      >
        New meeting
      </button>
      {error && <span className="skipped-notes-error">{error}</span>}
    </div>
  );
}
