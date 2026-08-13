"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { ProjectRelationKind } from "@/db/schema";
import {
  KIND_OPTION_LABEL,
  RELATION_KINDS,
  relationLabel,
} from "../../relation-kinds";

export type RailRelation = {
  id: string;
  kind: ProjectRelationKind;
  direction: "out" | "in";
  otherId: string;
  otherName: string;
  otherStatus: "active" | "archived" | "parked";
};

type SearchProject = { id: string; name: string };

// Capture-in-the-moment: something adjacent comes up in a meeting about project
// X, and it needs a home before it evaporates. Typing a name creates a PARKED
// project already connected to X and stamped with this meeting; picking an
// existing project just draws the edge.
export function RelatedProjectsRail({
  projectId,
  meetingId,
  initial,
}: {
  // The meeting's project — null when the meeting isn't tagged to one yet.
  projectId: string | null;
  meetingId: string;
  initial: RailRelation[];
}) {
  const [relations, setRelations] = useState(initial);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchProject[]>([]);
  const [searching, setSearching] = useState(false);
  const [kind, setKind] = useState<ProjectRelationKind>("related");
  const [busy, setBusy] = useState(false);
  // `busy` drives the disabled attribute, but two fast Enters both read the
  // same render's value — the ref is what actually closes the window.
  const submittingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { projects?: SearchProject[] };
        setResults(data.projects ?? []);
      } catch {
        /* ignore */
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => clearTimeout(id);
  }, [query]);

  // Errors here interrupt a live meeting, so they clear themselves rather than
  // needing a dismiss click (same idea as the dependency view's rejections).
  function fail(message: string) {
    setError(message);
    setTimeout(() => setError(null), 2500);
  }

  if (!projectId) {
    return (
      <p className="muted empty-sm">
        Tag this meeting to a project to capture related work.
      </p>
    );
  }

  async function link(other: SearchProject) {
    if (!projectId || submittingRef.current) return;
    if (relations.some((r) => r.otherId === other.id)) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/project-relations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromId: projectId,
          toId: other.id,
          kind,
          createdInMeetingId: meetingId,
        }),
      });
      const data = (await res.json()) as {
        relation?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.relation) {
        fail(data.error ?? "Could not connect those projects.");
        return;
      }
      setRelations((prev) => [
        ...prev,
        {
          id: data.relation!.id,
          kind,
          direction: "out",
          otherId: other.id,
          otherName: other.name,
          otherStatus: "active",
        },
      ]);
      setQuery("");
      setResults([]);
    } catch {
      fail("Could not connect those projects.");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  async function capture(name: string) {
    if (!projectId || submittingRef.current) return;
    submittingRef.current = true;
    setBusy(true);
    try {
      const res = await fetch("/api/project-relations/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromProjectId: projectId,
          name,
          kind,
          meetingId,
        }),
      });
      const data = (await res.json()) as {
        project?: { id: string; name: string };
        relation?: { id: string };
        error?: string;
      };
      if (!res.ok || !data.project || !data.relation) {
        fail(data.error ?? "Could not save that.");
        return;
      }
      setRelations((prev) => [
        ...prev,
        {
          id: data.relation!.id,
          kind,
          direction: "out",
          otherId: data.project!.id,
          otherName: data.project!.name,
          otherStatus: "parked",
        },
      ]);
      setQuery("");
      setResults([]);
    } catch {
      fail("Could not save that.");
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  async function unlink(id: string) {
    const prev = relations;
    setRelations(prev.filter((r) => r.id !== id));
    try {
      const res = await fetch(`/api/project-relations/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
    } catch {
      setRelations(prev);
    }
  }

  const typed = query.trim();
  const visibleResults = results.filter(
    (p) => p.id !== projectId && !relations.some((r) => r.otherId === p.id),
  );
  const exactMatch = visibleResults.some(
    (p) => p.name.toLowerCase() === typed.toLowerCase(),
  );

  return (
    <>
      {relations.length === 0 ? (
        <p className="muted empty-sm">Nothing connected yet.</p>
      ) : (
        <ul className="attach-list">
          {relations.map((r) => (
            <li key={r.id} className="attach-row">
              <Link href={`/projects/${r.otherId}`} className="attach-link">
                <span className="attach-title">{r.otherName}</span>
                <span className="attach-meta">
                  {relationLabel(r.kind, r.direction)}
                  {r.otherStatus === "parked" && " · parked"}
                </span>
              </Link>
              <button
                type="button"
                className="note-remove"
                onClick={() => unlink(r.id)}
                aria-label={`Disconnect ${r.otherName}`}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="attach-search rel-add">
        <div className="rel-add-row">
          <select
            className="rel-kind-select"
            value={kind}
            onChange={(e) => setKind(e.target.value as ProjectRelationKind)}
            aria-label="How it relates"
          >
            {RELATION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_OPTION_LABEL[k]}
              </option>
            ))}
          </select>
          <input
            type="text"
            className="attach-search-input"
            placeholder="Name something that came up…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter on free text is the fast path — no picking, no dialog.
              if (e.key === "Enter" && typed && !busy) {
                e.preventDefault();
                if (!exactMatch) void capture(typed);
              }
            }}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
          />
        </div>
        {typed.length >= 2 && (
          <div className="attach-results">
            {visibleResults.map((p) => (
              <button
                key={p.id}
                type="button"
                className="attach-result"
                onClick={() => link(p)}
                disabled={busy}
              >
                <span className="attach-title">{p.name}</span>
                <span className="attach-meta">existing project</span>
              </button>
            ))}
            {!exactMatch && (
              <button
                type="button"
                className="attach-result rel-create"
                onClick={() => capture(typed)}
                disabled={busy}
              >
                <span className="attach-title">{`Create “${typed}”`}</span>
                <span className="attach-meta">
                  parked idea, connected to this project
                </span>
              </button>
            )}
            {visibleResults.length === 0 && searching && (
              <div className="attach-results-hint">Searching…</div>
            )}
          </div>
        )}
        {error && <p className="login-error rel-error">{error}</p>}
      </div>
    </>
  );
}
