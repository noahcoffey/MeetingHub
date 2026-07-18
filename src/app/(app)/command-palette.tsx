"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type MeetingRes = { id: string; title: string; subtitle: string };
type ActionRes = {
  id: string;
  content: string;
  meetingId: string | null;
  subtitle: string;
};
type ProjectRes = { id: string; name: string };
type NoteRes = { id: string; title: string };

const OPEN_EVENT = "mh:open-search";

function MeetingIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path d="M4 5.5h12M4 10h12M4 14.5h7" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
function ActionIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M4 10l3 3 6-7"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function ProjectIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M3.5 6a1 1 0 011-1h4l1.5 1.5H15a1 1 0 011 1V14a1 1 0 01-1 1H4.5a1 1 0 01-1-1V6z"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function NoteIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M4.5 4.5a1 1 0 011-1h9a1 1 0 011 1v7l-4.5 4.5h-5.5a1 1 0 01-1-1v-10.5z"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M11 16v-3.5a1 1 0 011-1h3.5" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export function CommandPalette({ workspaceName }: { workspaceName?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [meetings, setMeetings] = useState<MeetingRes[]>([]);
  const [actions, setActions] = useState<ActionRes[]>([]);
  const [projects, setProjects] = useState<ProjectRes[]>([]);
  const [notes, setNotes] = useState<NoteRes[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Carry the query so the meeting page can highlight the matched term(s).
  const hl = q.trim();
  const meetingHref = (id: string) =>
    `/meetings/${id}${hl ? `?q=${encodeURIComponent(hl)}` : ""}`;

  const items = [
    ...meetings.map((m) => ({ key: `m-${m.id}`, href: meetingHref(m.id) })),
    ...actions.map((a) => ({
      key: `a-${a.id}`,
      href: a.meetingId ? meetingHref(a.meetingId) : "/tasks",
    })),
    ...projects.map((p) => ({ key: `p-${p.id}`, href: `/projects/${p.id}` })),
    ...notes.map((n) => ({ key: `n-${n.id}`, href: `/notes/${n.id}` })),
  ];

  // hotkeys + open event from the sidebar trigger
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "/" && !open) {
        const t = e.target as HTMLElement | null;
        const typing =
          !!t &&
          (t.tagName === "INPUT" ||
            t.tagName === "TEXTAREA" ||
            t.isContentEditable);
        if (!typing) {
          e.preventDefault();
          setOpen(true);
        }
      }
    }
    function onOpen(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string" && detail.trim()) setQ(detail.trim());
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, [open]);

  // reset on open/close
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 10);
      return () => clearTimeout(id);
    }
    setQ("");
    setMeetings([]);
    setActions([]);
    setProjects([]);
    setNotes([]);
    setActive(0);
  }, [open]);

  // debounced search
  useEffect(() => {
    if (!open) return;
    const query = q.trim();
    if (query.length < 2) {
      setMeetings([]);
      setActions([]);
      setProjects([]);
      setNotes([]);
      setActive(0);
      return;
    }
    setLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        setMeetings(data.meetings ?? []);
        setActions(data.actions ?? []);
        setProjects(data.projects ?? []);
        setNotes(data.notes ?? []);
        setActive(0);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => clearTimeout(id);
  }, [q, open]);

  // keep the active row in view
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[active];
      if (it) go(it.href);
    }
  }

  if (!open) return null;

  const query = q.trim();
  const hasResults =
    meetings.length + actions.length + projects.length + notes.length > 0;

  return (
    <div className="cmdk-overlay" onMouseDown={() => setOpen(false)}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="cmdk-input"
          placeholder={
            workspaceName
              ? `Search ${workspaceName} — meetings, tasks, projects, notes…`
              : "Search meetings, action items, projects, and notes…"
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onInputKey}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="cmdk-results" ref={listRef}>
          {query.length < 2 ? (
            <div className="cmdk-hint">Type at least 2 characters…</div>
          ) : !hasResults ? (
            <div className="cmdk-hint">{loading ? "Searching…" : "No results"}</div>
          ) : (
            <>
              {meetings.length > 0 && <div className="cmdk-group">Meetings</div>}
              {meetings.map((m, i) => (
                <button
                  key={m.id}
                  data-idx={i}
                  className={`cmdk-row ${active === i ? "is-active" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(meetingHref(m.id))}
                >
                  <span className="cmdk-icon">
                    <MeetingIcon />
                  </span>
                  <span className="cmdk-text">
                    <span className="cmdk-title">{m.title}</span>
                    <span className="cmdk-sub">{m.subtitle}</span>
                  </span>
                </button>
              ))}
              {actions.length > 0 && (
                <div className="cmdk-group">Action items</div>
              )}
              {actions.map((a, i) => {
                const idx = meetings.length + i;
                return (
                  <button
                    key={a.id}
                    data-idx={idx}
                    className={`cmdk-row ${active === idx ? "is-active" : ""}`}
                    onMouseMove={() => setActive(idx)}
                    onClick={() =>
                      go(a.meetingId ? meetingHref(a.meetingId) : "/tasks")
                    }
                  >
                    <span className="cmdk-icon">
                      <ActionIcon />
                    </span>
                    <span className="cmdk-text">
                      <span className="cmdk-title">{a.content}</span>
                      <span className="cmdk-sub">{a.subtitle}</span>
                    </span>
                  </button>
                );
              })}
              {projects.length > 0 && <div className="cmdk-group">Projects</div>}
              {projects.map((p, i) => {
                const idx = meetings.length + actions.length + i;
                return (
                  <button
                    key={p.id}
                    data-idx={idx}
                    className={`cmdk-row ${active === idx ? "is-active" : ""}`}
                    onMouseMove={() => setActive(idx)}
                    onClick={() => go(`/projects/${p.id}`)}
                  >
                    <span className="cmdk-icon">
                      <ProjectIcon />
                    </span>
                    <span className="cmdk-text">
                      <span className="cmdk-title">{p.name}</span>
                    </span>
                  </button>
                );
              })}
              {notes.length > 0 && <div className="cmdk-group">Notes</div>}
              {notes.map((n, i) => {
                const idx = meetings.length + actions.length + projects.length + i;
                return (
                  <button
                    key={n.id}
                    data-idx={idx}
                    className={`cmdk-row ${active === idx ? "is-active" : ""}`}
                    onMouseMove={() => setActive(idx)}
                    onClick={() => go(`/notes/${n.id}`)}
                  >
                    <span className="cmdk-icon">
                      <NoteIcon />
                    </span>
                    <span className="cmdk-text">
                      <span className="cmdk-title">{n.title}</span>
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
        <div className="cmdk-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  );
}

export function SearchTrigger() {
  return (
    <button
      type="button"
      className="search-trigger"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EVENT))}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
        <circle cx="9" cy="9" r="5.5" strokeWidth="1.6" />
        <path d="M13.5 13.5L17 17" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className="search-trigger-label">Search</span>
      <kbd className="search-trigger-kbd">⌘K</kbd>
    </button>
  );
}
