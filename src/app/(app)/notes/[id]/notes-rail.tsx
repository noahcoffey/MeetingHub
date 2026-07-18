"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`rail-chevron ${open ? "open" : ""}`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      aria-hidden
    >
      <path d="M7 5l5 5-5 5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export type AttachedProject = { id: string; name: string };
// meta = a human date label (server-formatted for initial rows, the search
// result subtitle for freshly attached ones).
export type AttachedMeeting = { id: string; title: string; meta: string };

type SearchMeeting = { id: string; title: string; subtitle: string };

// Right rail for a note: attached Projects and Meetings (add/remove) over the
// shared Action items list.
export function NotesRail({
  noteId,
  initialProjects,
  initialMeetings,
  allProjects,
  children,
}: {
  noteId: string;
  initialProjects: AttachedProject[];
  initialMeetings: AttachedMeeting[];
  allProjects: AttachedProject[];
  children: React.ReactNode;
}) {
  const [attachedProjects, setAttachedProjects] = useState(initialProjects);
  const [attachedMeetings, setAttachedMeetings] = useState(initialMeetings);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [meetingsOpen, setMeetingsOpen] = useState(true);
  const [itemsOpen, setItemsOpen] = useState(true);

  // -- meeting search (debounced, reuses the global /api/search endpoint) --
  const [meetingQuery, setMeetingQuery] = useState("");
  const [meetingResults, setMeetingResults] = useState<SearchMeeting[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = meetingQuery.trim();
    if (q.length < 2) {
      setMeetingResults([]);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { meetings?: SearchMeeting[] };
        setMeetingResults(data.meetings ?? []);
      } catch {
        /* ignore */
      } finally {
        setSearching(false);
      }
    }, 180);
    return () => clearTimeout(id);
  }, [meetingQuery]);

  async function attach(body: { projectId: string } | { meetingId: string }) {
    const res = await fetch(`/api/notes/${noteId}/attachments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
  }

  async function detach(body: { projectId: string } | { meetingId: string }) {
    const res = await fetch(`/api/notes/${noteId}/attachments`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error();
  }

  async function addProject(projectId: string) {
    const project = allProjects.find((p) => p.id === projectId);
    if (!project || attachedProjects.some((p) => p.id === projectId)) return;
    const prev = attachedProjects;
    setAttachedProjects([...prev, project].sort((a, b) => a.name.localeCompare(b.name)));
    try {
      await attach({ projectId });
    } catch {
      setAttachedProjects(prev);
    }
  }

  async function removeProject(projectId: string) {
    const prev = attachedProjects;
    setAttachedProjects(prev.filter((p) => p.id !== projectId));
    try {
      await detach({ projectId });
    } catch {
      setAttachedProjects(prev);
    }
  }

  async function addMeeting(m: SearchMeeting) {
    if (attachedMeetings.some((a) => a.id === m.id)) return;
    const prev = attachedMeetings;
    setAttachedMeetings([{ id: m.id, title: m.title, meta: m.subtitle }, ...prev]);
    setMeetingQuery("");
    setMeetingResults([]);
    try {
      await attach({ meetingId: m.id });
    } catch {
      setAttachedMeetings(prev);
    }
  }

  async function removeMeeting(meetingId: string) {
    const prev = attachedMeetings;
    setAttachedMeetings(prev.filter((m) => m.id !== meetingId));
    try {
      await detach({ meetingId });
    } catch {
      setAttachedMeetings(prev);
    }
  }

  const unattachedProjects = allProjects.filter(
    (p) => !attachedProjects.some((a) => a.id === p.id),
  );
  const visibleResults = meetingResults.filter(
    (m) => !attachedMeetings.some((a) => a.id === m.id),
  );

  return (
    <div className="rail-sections">
      <section className={`rail-section ${projectsOpen ? "open" : "collapsed"}`}>
        <button
          type="button"
          className="rail-section-head"
          onClick={() => setProjectsOpen((o) => !o)}
          aria-expanded={projectsOpen}
        >
          <Chevron open={projectsOpen} />
          Projects
        </button>
        {projectsOpen && (
          <div className="rail-section-body">
            {attachedProjects.length === 0 ? (
              <p className="muted empty-sm">Not attached to a project.</p>
            ) : (
              <ul className="attach-list">
                {attachedProjects.map((p) => (
                  <li key={p.id} className="attach-row">
                    <Link href={`/projects/${p.id}`} className="attach-link">
                      {p.name}
                    </Link>
                    <button
                      type="button"
                      className="note-remove"
                      onClick={() => removeProject(p.id)}
                      aria-label={`Detach ${p.name}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {unattachedProjects.length > 0 && (
              <select
                className="attach-select"
                value=""
                onChange={(e) => {
                  if (e.target.value) addProject(e.target.value);
                }}
                aria-label="Attach a project"
              >
                <option value="">Attach a project…</option>
                {unattachedProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
      </section>

      <section className={`rail-section ${meetingsOpen ? "open" : "collapsed"}`}>
        <button
          type="button"
          className="rail-section-head"
          onClick={() => setMeetingsOpen((o) => !o)}
          aria-expanded={meetingsOpen}
        >
          <Chevron open={meetingsOpen} />
          Meetings
        </button>
        {meetingsOpen && (
          <div className="rail-section-body">
            {attachedMeetings.length === 0 ? (
              <p className="muted empty-sm">Not attached to a meeting.</p>
            ) : (
              <ul className="attach-list">
                {attachedMeetings.map((m) => (
                  <li key={m.id} className="attach-row">
                    <Link href={`/meetings/${m.id}`} className="attach-link">
                      <span className="attach-title">{m.title}</span>
                      <span className="attach-meta">{m.meta}</span>
                    </Link>
                    <button
                      type="button"
                      className="note-remove"
                      onClick={() => removeMeeting(m.id)}
                      aria-label={`Detach ${m.title}`}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="attach-search">
              <input
                type="search"
                className="attach-search-input"
                placeholder="Search meetings to attach…"
                value={meetingQuery}
                onChange={(e) => setMeetingQuery(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              {meetingQuery.trim().length >= 2 && (
                <div className="attach-results">
                  {visibleResults.length === 0 ? (
                    <div className="attach-results-hint">
                      {searching ? "Searching…" : "No matching meetings"}
                    </div>
                  ) : (
                    visibleResults.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="attach-result"
                        onClick={() => addMeeting(m)}
                      >
                        <span className="attach-title">{m.title}</span>
                        <span className="attach-meta">{m.subtitle}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className={`rail-section weight-1 ${itemsOpen ? "open" : "collapsed"}`}>
        <button
          type="button"
          className="rail-section-head"
          onClick={() => setItemsOpen((o) => !o)}
          aria-expanded={itemsOpen}
        >
          <Chevron open={itemsOpen} />
          Action items
        </button>
        {itemsOpen && <div className="rail-section-body">{children}</div>}
      </section>
    </div>
  );
}
