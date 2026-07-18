"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { recurrenceLabel, type RecurrenceUnit } from "@/lib/recurrence";
import { ProjectPicker, type ProjectOption } from "./project-picker";
import type { ClientItem } from "./action-item-mapper";

export type { ClientItem };
export type PersonOption = { id: string; name: string };

export type Recurrence = { unit: RecurrenceUnit; interval: number };

// Resizes a wrapping textarea to fit its content (no scrollbar, no fixed row count).
function autoGrow(el: HTMLTextAreaElement | null): void {
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function formatDue(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, day, 12));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(dt);
}

// End of the current calendar week (Sunday) as YYYY-MM-DD, for the due groupings.
function endOfWeek(todayStr: string): string {
  const [y, m, d] = todayStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const daysUntilSunday = (7 - dt.getUTCDay()) % 7;
  dt.setUTCDate(dt.getUTCDate() + daysUntilSunday);
  return dt.toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const CalendarIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
    <rect x="3.5" y="4.5" width="13" height="12" rx="2" strokeWidth="1.5" />
    <path d="M3.5 8h13M7 3v3M13 3v3" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

const StopIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden>
    <path d="M6.6 2h6.8L18 6.6v6.8L13.4 18H6.6L2 13.4V6.6z" />
  </svg>
);

const FlagIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
    <path
      d="M5.5 17.5V3.5m0 .5h8.5l-2.2 3 2.2 3H5.5"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const RepeatIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
    <path
      d="M4.5 8.5V8a3 3 0 0 1 3-3H16m0 0-2.5-2.5M16 5l-2.5 2.5M15.5 11.5v.5a3 3 0 0 1-3 3H4m0 0 2.5 2.5M4 15l2.5-2.5"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const PersonIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
    <circle cx="10" cy="6.5" r="3" strokeWidth="1.5" />
    <path d="M4 16.5a6 6 0 0 1 12 0" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

// Waiting-on picker: link a person, type a free-text name, or clear. The
// server derives owner ("me"/"other") from these two fields.
function WaitingOnPopover({
  personId,
  freeText,
  people,
  onChange,
  showLabel = false,
}: {
  personId: string | null;
  freeText: string | null;
  people: PersonOption[];
  onChange: (v: { personId: string | null; name: string | null }) => void;
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const display =
    (personId && people.find((p) => p.id === personId)?.name) || freeText;
  const isSet = !!display;

  function pick(v: { personId: string | null; name: string | null }) {
    setOpen(false);
    setDraft("");
    onChange(v);
  }

  return (
    <span className="due-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`due-trigger ${isSet ? "has-date" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={display ? `Waiting on ${display}` : "Waiting on…"}
        aria-label={display ? `Waiting on ${display}` : "Set waiting on"}
      >
        <PersonIcon />
        {(isSet || showLabel) && (
          <span className="due-pill">
            {display ? `Waiting on ${display}` : "Waiting on"}
          </span>
        )}
      </button>
      {open && (
        <div className="due-popover prio-popover" role="dialog">
          {people.map((p) => (
            <button
              key={p.id}
              type="button"
              className={`prio-option ${p.id === personId ? "is-active" : ""}`}
              onClick={() => pick({ personId: p.id, name: null })}
            >
              {p.name}
            </button>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) pick({ personId: null, name: draft.trim() });
            }}
          >
            <input
              type="text"
              placeholder="Someone else…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
          </form>
          {isSet && (
            <button
              type="button"
              className="due-clear"
              onClick={() => pick({ personId: null, name: null })}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </span>
  );
}

const MoonIcon = () => (
  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
    <path
      d="M16.5 12.2A6.8 6.8 0 0 1 7.8 3.5a6.8 6.8 0 1 0 8.7 8.7z"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

// One-way control: picking a date hides the row (snoozed items are excluded
// from every open list server-side), so there's never a value to display.
function SnoozePopover({
  today,
  onSnooze,
}: {
  today: string;
  onSnooze: (until: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(until: string) {
    setOpen(false);
    onSnooze(until);
  }

  return (
    <span className="due-wrap" ref={wrapRef}>
      <button
        type="button"
        className="due-trigger"
        onClick={() => setOpen((o) => !o)}
        title="Snooze"
        aria-label="Snooze"
      >
        <MoonIcon />
      </button>
      {open && (
        <div className="due-popover prio-popover" role="dialog">
          <button
            type="button"
            className="prio-option"
            onClick={() => pick(addDays(today, 1))}
          >
            Tomorrow
          </button>
          <button
            type="button"
            className="prio-option"
            onClick={() => pick(addDays(today, 7))}
          >
            Next week
          </button>
          <input
            type="date"
            min={addDays(today, 1)}
            onChange={(e) => {
              if (e.target.value && e.target.value > today) pick(e.target.value);
            }}
          />
        </div>
      )}
    </span>
  );
}

const RECURRENCE_PRESETS: Recurrence[] = [
  { unit: "day", interval: 1 },
  { unit: "weekday", interval: 1 },
  { unit: "week", interval: 1 },
  { unit: "week", interval: 2 },
  { unit: "month", interval: 1 },
  { unit: "month", interval: 3 },
  { unit: "year", interval: 1 },
];

function RepeatPopover({
  value,
  onChange,
  showLabel = false,
}: {
  value: Recurrence | null;
  onChange: (v: Recurrence | null) => void;
  // When true, a set rule shows its cadence as a pill (wide layouts); when
  // false it only lights the icon and the cadence lives in the tooltip.
  showLabel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const title = value
    ? `Repeats ${recurrenceLabel(value.unit, value.interval).toLowerCase()}`
    : "Set repeat";
  return (
    <span className="due-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`due-trigger ${value ? "has-repeat" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={title}
        aria-label={title}
      >
        <RepeatIcon />
        {showLabel && value && (
          <span className="due-pill">{recurrenceLabel(value.unit, value.interval)}</span>
        )}
      </button>
      {open && (
        <div className="due-popover prio-popover repeat-popover" role="dialog">
          {RECURRENCE_PRESETS.map((p) => {
            const isActive =
              value?.unit === p.unit && value?.interval === p.interval;
            return (
              <button
                type="button"
                key={`${p.unit}-${p.interval}`}
                className={`prio-option ${isActive ? "is-active" : ""}`}
                onClick={() => {
                  onChange(isActive ? null : p);
                  setOpen(false);
                }}
              >
                {recurrenceLabel(p.unit, p.interval)}
              </button>
            );
          })}
          {value && (
            <button
              type="button"
              className="due-clear"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </span>
  );
}

const PRIORITIES = [
  { value: 1, label: "High", short: "High" },
  { value: 2, label: "Medium", short: "Med" },
  { value: 3, label: "Low", short: "Low" },
] as const;

function priorityShort(p: number): string {
  return PRIORITIES.find((x) => x.value === p)?.short ?? "";
}

export type MilestoneOption = { id: string; name: string };

// Pennant-on-pole — matches the runway's milestone flag, and reads differently
// from the priority flag's rounded banner.
function PennantIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path d="M6 17V3" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M6 4h8l-2.6 3L14 10H6z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function MilestonePopover({
  value,
  milestones,
  onChange,
}: {
  value: string | null;
  milestones: MilestoneOption[];
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const current = milestones.find((m) => m.id === value) ?? null;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="due-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`due-trigger ${current ? "has-due" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={current ? `Milestone: ${current.name}` : "Assign to milestone"}
        aria-label={current ? `Milestone: ${current.name}` : "Assign to milestone"}
      >
        <PennantIcon />
        {current && <span className="due-pill ms-pill">{current.name}</span>}
      </button>
      {open && (
        <div className="due-popover prio-popover" role="dialog">
          {milestones.map((m) => (
            <button
              type="button"
              key={m.id}
              className={`prio-option ${value === m.id ? "is-active" : ""}`}
              onClick={() => {
                onChange(value === m.id ? null : m.id);
                setOpen(false);
              }}
            >
              {m.name}
            </button>
          ))}
          {value && (
            <button
              type="button"
              className="due-clear"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              None
            </button>
          )}
        </div>
      )}
    </span>
  );
}

function PriorityPopover({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="due-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`due-trigger prio-trigger ${value ? `has-prio prio-${value}` : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={value ? `${priorityShort(value)} priority` : "Set priority"}
        aria-label={value ? `${priorityShort(value)} priority` : "Set priority"}
      >
        <FlagIcon />
        {value && <span className="due-pill">{priorityShort(value)}</span>}
      </button>
      {open && (
        <div className="due-popover prio-popover" role="dialog">
          {PRIORITIES.map((p) => (
            <button
              type="button"
              key={p.value}
              className={`prio-option prio-${p.value} ${value === p.value ? "is-active" : ""}`}
              onClick={() => {
                onChange(value === p.value ? null : p.value);
                setOpen(false);
              }}
            >
              {p.label}
            </button>
          ))}
          {value && (
            <button
              type="button"
              className="due-clear"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </span>
  );
}

function DueDatePopover({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const today = new Intl.DateTimeFormat("en-CA").format(new Date());
  const overdue = value !== null && value < today;

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span className="due-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`due-trigger ${value ? "has-date" : ""} ${overdue ? "overdue" : ""}`}
        onClick={() => setOpen((o) => !o)}
        title={value ? `Due ${value}` : "Set due date"}
        aria-label={value ? `Due ${value}` : "Set due date"}
      >
        <CalendarIcon />
        {value && <span className="due-pill">{formatDue(value)}</span>}
      </button>
      {open && (
        <div className="due-popover" role="dialog">
          <input
            type="date"
            value={value ?? ""}
            autoFocus
            onChange={(e) => {
              onChange(e.target.value || null);
              if (e.target.value) setOpen(false);
            }}
          />
          {value && (
            <button
              type="button"
              className="due-clear"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              Clear
            </button>
          )}
        </div>
      )}
    </span>
  );
}

export function ActionItemsList({
  currentMeetingId = null,
  currentJournalEntryId = null,
  today,
  initialItems,
  variant = "open",
  projects = [],
  defaultProjectId = null,
  groupBy = "context",
  showProjectPrefix = false,
  metaLayout = "quiet",
  dependencyInfo,
  people,
  defaultWaitingOnPersonId = null,
  milestones,
}: {
  currentMeetingId?: string | null;
  currentJournalEntryId?: string | null;
  today: string;
  initialItems: ClientItem[];
  variant?: "open" | "done";
  projects?: ProjectOption[];
  // Pre-tags items added from a project's own page — otherwise they'd render in
  // this project-scoped list optimistically, then vanish on reload untagged.
  defaultProjectId?: string | null;
  // "context": this meeting/entry → overdue → due today → this week → next
  //   week → later incl. undated (default, the rails).
  // "created": created today → earlier — the Tasks page "Created" toggle.
  // "due": today (incl. overdue) → this week → later, by due date.
  // "project": one group per project, "No project" last — the Tasks page.
  // "priority": high → medium → low → no priority — the Tasks page.
  // "waiting": one group per waiting-on name, "Not waiting" last.
  groupBy?: "context" | "created" | "due" | "project" | "priority" | "waiting";
  // Prefixes the row with its project name as text, in addition to the icon
  // picker — opt-in so other pages keep the icon-only look.
  showProjectPrefix?: boolean;
  // "quiet" (default, the rails): one line per task — set values show as
  // pills on the title row, unset pickers only appear on row hover.
  // "inline": every picker always visible with value pills — the full-width
  // Tasks page.
  metaLayout?: "quiet" | "inline";
  // taskId -> tooltip text for tasks with an unmet dependency; presence in the
  // map is what draws the stop icon, so omit entries for unblocked tasks.
  dependencyInfo?: Map<string, string>;
  // When provided, rows get the "waiting on" picker (person list + free text).
  // Omitted on the journal/day rails to keep them unchanged.
  people?: PersonOption[];
  // Pre-tags items added from a person's own page as waiting on them.
  defaultWaitingOnPersonId?: string | null;
  // When provided (the project hub's tasks tab), rows get a milestone picker.
  // Everywhere else the prop is absent and nothing renders.
  milestones?: MilestoneOption[];
}) {
  const isDone = variant === "done";
  const router = useRouter();
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));
  const personNameById = new Map((people ?? []).map((p) => [p.id, p.name]));
  const waitingLabel = (it: ClientItem): string | null =>
    (it.waitingOnPersonId && personNameById.get(it.waitingOnPersonId)) ||
    it.ownerName ||
    null;
  const listRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<ClientItem[]>(initialItems);
  const [content, setContent] = useState("");
  const [newDue, setNewDue] = useState<string | null>(null);
  const [newPriority, setNewPriority] = useState<number | null>(null);
  const [newRecurrence, setNewRecurrence] = useState<Recurrence | null>(null);
  const [newProjectId, setNewProjectId] = useState<string | null>(defaultProjectId);
  const [newMilestoneId, setNewMilestoneId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Deletions are held here for a grace period (with an Undo toast) before the
  // DELETE actually fires — a mis-click was previously unrecoverable. The ref is
  // the source of truth for bookkeeping (timers read it outside render); the
  // state mirror only drives the toast render.
  const [pendingDeletes, setPendingDeletes] = useState<ClientItem[]>([]);
  const deleteTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const pendingRef = useRef(new Map<string, { item: ClientItem; index: number }>());

  // Re-sync when the server sends new data (e.g. router.refresh() after adding an
  // action item from the notes selection toolbar). Items awaiting their delayed
  // DELETE stay hidden even if the refresh still includes them.
  const signature = JSON.stringify(initialItems);
  useEffect(() => {
    setItems(initialItems.filter((it) => !pendingRef.current.has(it.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Re-fit every auto-grown textarea when the list's width changes (rail drag,
  // sidebar toggle, window resize) — text rewraps but height only updates on input.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    let lastWidth = el.clientWidth;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w === lastWidth) return;
      lastWidth = w;
      el.querySelectorAll<HTMLTextAreaElement>("textarea.ai-content").forEach(autoGrow);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // If the component unmounts (navigation) with deletes still pending, flush
  // them immediately — otherwise the timers die and the items resurrect.
  useEffect(() => {
    const timers = deleteTimers.current;
    const pending = pendingRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      for (const id of pending.keys()) {
        void fetch(`/api/action-items/${id}`, { method: "DELETE", keepalive: true });
      }
      pending.clear();
    };
  }, []);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setAdding(true);
    try {
      const res = await fetch("/api/action-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          meetingId: currentMeetingId,
          journalEntryId: currentJournalEntryId,
          content: content.trim(),
          dueDate: newDue,
          priority: newPriority,
          projectId: newProjectId,
          milestoneId: newMilestoneId,
          recurrenceUnit: newRecurrence?.unit ?? null,
          recurrenceInterval: newRecurrence?.interval ?? null,
          waitingOnPersonId: defaultWaitingOnPersonId,
        }),
      });
      if (!res.ok) throw new Error("create failed");
      const { item } = await res.json();
      setItems((prev) => [
        {
          id: item.id,
          content: item.content,
          dueDate: item.dueDate,
          meetingId: item.meetingId,
          journalEntryId: item.journalEntryId,
          projectId: item.projectId,
          milestoneId: item.milestoneId,
          priority: item.priority,
          recurrenceUnit: item.recurrenceUnit,
          recurrenceInterval: item.recurrenceInterval,
          waitingOnPersonId: item.waitingOnPersonId,
          ownerName: item.ownerName,
          createdDay: today,
        },
        ...prev,
      ]);
      setContent("");
      setNewDue(null);
      setNewPriority(null);
      setNewRecurrence(null);
      setNewProjectId(defaultProjectId);
      setNewMilestoneId(null);
      router.refresh();
    } catch {
      /* keep form populated */
    } finally {
      setAdding(false);
    }
  }

  async function patch(id: string, body: Partial<ClientItem>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...body } : it)));
    try {
      await fetch(`/api/action-items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      // Due-date moves change the sidebar's due-today badge.
      if (body.dueDate !== undefined) router.refresh();
    } catch {
      /* optimistic; reconciles on reload */
    }
  }

  async function complete(id: string) {
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== id));
    try {
      const res = await fetch(`/api/action-items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "done" }),
      });
      if (!res.ok) throw new Error();
      // Completing a recurring item spawns its next occurrence server-side.
      // Only surface it now if it's already due — a future occurrence stays
      // hidden until its date arrives (it lives under Tasks → Scheduled).
      const { next } = (await res.json()) as { next?: ClientItem | null };
      if (next && !(next.recurrenceUnit && next.dueDate && next.dueDate > today)) {
        setItems((p) => [
          {
            id: next.id,
            content: next.content,
            dueDate: next.dueDate,
            meetingId: next.meetingId,
            journalEntryId: next.journalEntryId,
            projectId: next.projectId,
            milestoneId: next.milestoneId,
            priority: next.priority,
            recurrenceUnit: next.recurrenceUnit,
            recurrenceInterval: next.recurrenceInterval,
            waitingOnPersonId: next.waitingOnPersonId,
            ownerName: next.ownerName,
            createdDay: today,
          },
          ...p,
        ]);
      }
      // Re-render the server tree so the sidebar task counts stay current
      // (recurrence means the server is the only one who knows the new count).
      router.refresh();
    } catch {
      setItems(prev);
    }
  }

  async function snoozeItem(id: string, until: string) {
    // Snoozed items are hidden from every open list — remove the row now.
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== id));
    try {
      const res = await fetch(`/api/action-items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ snoozedUntil: until }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setItems(prev);
    }
  }

  async function reopen(id: string) {
    const prev = items;
    setItems((p) => p.filter((it) => it.id !== id));
    try {
      const res = await fetch(`/api/action-items/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "open" }),
      });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setItems(prev);
    }
  }

  const UNDO_MS = 5000;

  function restoreItem(entry: { item: ClientItem; index: number }) {
    setItems((prev) => {
      const next = [...prev];
      next.splice(Math.min(entry.index, next.length), 0, entry.item);
      return next;
    });
  }

  function remove(id: string) {
    const index = items.findIndex((it) => it.id === id);
    if (index === -1) return;
    const item = items[index];
    setItems((p) => p.filter((it) => it.id !== id));
    pendingRef.current.set(id, { item, index });
    setPendingDeletes((p) => [...p, item]);
    deleteTimers.current.set(
      id,
      setTimeout(() => void finalizeDelete(id), UNDO_MS),
    );
  }

  async function finalizeDelete(id: string) {
    deleteTimers.current.delete(id);
    const entry = pendingRef.current.get(id);
    pendingRef.current.delete(id);
    setPendingDeletes((p) => p.filter((it) => it.id !== id));
    try {
      const res = await fetch(`/api/action-items/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      // Delete failed after the toast expired — put the item back.
      if (entry) restoreItem(entry);
    }
  }

  function undoDelete(id: string) {
    const timer = deleteTimers.current.get(id);
    if (timer) clearTimeout(timer);
    deleteTimers.current.delete(id);
    const entry = pendingRef.current.get(id);
    pendingRef.current.delete(id);
    setPendingDeletes((p) => p.filter((it) => it.id !== id));
    if (entry) restoreItem(entry);
  }

  // Done variant: one flat list (already ordered by completedAt desc from the server).
  // Open variant groups by the groupBy mode documented on the prop above.
  let groups: { key: string; label: string; items: ClientItem[] }[];
  if (isDone) {
    groups = items.length ? [{ key: "done", label: "Completed", items }] : [];
  } else if (groupBy === "project") {
    const byProject = new Map<string, ClientItem[]>();
    const noProject: ClientItem[] = [];
    for (const it of items) {
      if (it.projectId && projectNameById.has(it.projectId)) {
        const list = byProject.get(it.projectId) ?? [];
        list.push(it);
        byProject.set(it.projectId, list);
      } else {
        noProject.push(it);
      }
    }
    const projectGroups = [...byProject.entries()]
      .map(([projectId, groupItems]) => ({
        key: projectId,
        label: projectNameById.get(projectId) as string,
        items: groupItems,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    groups = [
      ...projectGroups,
      { key: "no-project", label: "No project", items: noProject },
    ].filter((g) => g.items.length > 0);
  } else if (groupBy === "waiting") {
    // One group per waiting-on display name, "Not waiting" last.
    const byName = new Map<string, ClientItem[]>();
    const notWaiting: ClientItem[] = [];
    for (const it of items) {
      const name = waitingLabel(it);
      if (name) {
        const list = byName.get(name) ?? [];
        list.push(it);
        byName.set(name, list);
      } else {
        notWaiting.push(it);
      }
    }
    const waitingGroups = [...byName.entries()]
      .map(([name, groupItems]) => ({
        key: `wait-${name}`,
        label: `Waiting on ${name}`,
        items: groupItems,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    groups = [
      ...waitingGroups,
      { key: "not-waiting", label: "Not waiting", items: notWaiting },
    ].filter((g) => g.items.length > 0);
  } else if (groupBy === "priority") {
    // High → medium → low → unset; within a group, due-date soonest first
    // (undated last, keeping their newest-first arrival order).
    const byDueAsc = (a: ClientItem, b: ClientItem) =>
      (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99");
    const bucket = (p: number | null) =>
      items.filter((it) => it.priority === p).sort(byDueAsc);
    groups = [
      ...PRIORITIES.map((p) => ({
        key: `prio-${p.value}`,
        label: p.label,
        items: bucket(p.value),
      })),
      { key: "prio-none", label: "No priority", items: bucket(null) },
    ].filter((g) => g.items.length > 0);
  } else if (groupBy === "due") {
    const endWeek = endOfWeek(today);
    const byDueAsc = (a: ClientItem, b: ClientItem) =>
      (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
    const dueToday = items
      .filter((it) => it.dueDate !== null && it.dueDate <= today)
      .sort(byDueAsc);
    const dueThisWeek = items
      .filter((it) => it.dueDate !== null && it.dueDate > today && it.dueDate <= endWeek)
      .sort(byDueAsc);
    const soonIds = new Set([...dueToday, ...dueThisWeek].map((it) => it.id));
    const later = items.filter((it) => !soonIds.has(it.id));
    groups = [
      { key: "due-today", label: "Today", items: dueToday },
      { key: "due-week", label: "This week", items: dueThisWeek },
      { key: "later", label: "Later", items: later },
    ].filter((g) => g.items.length > 0);
  } else if (groupBy === "created") {
    const todayItems = items.filter((it) => it.createdDay === today);
    const earlier = items.filter((it) => it.createdDay !== today);
    groups = [
      { key: "today", label: "Today", items: todayItems },
      { key: "earlier", label: "Earlier", items: earlier },
    ].filter((g) => g.items.length > 0);
  } else {
    // "context" (the rails' default): this meeting/entry first, then everything
    // else laddered by due date — overdue → today → this week → next week →
    // later (undated items land in later).
    const hasContext = !!(currentMeetingId || currentJournalEntryId);
    const contextLabel = currentJournalEntryId ? "This entry" : "This meeting";
    const contextItems = currentMeetingId
      ? items.filter((it) => it.meetingId === currentMeetingId)
      : currentJournalEntryId
        ? items.filter((it) => it.journalEntryId === currentJournalEntryId)
        : [];
    const thisIds = new Set(contextItems.map((it) => it.id));
    const rest = items.filter((it) => !thisIds.has(it.id));
    const byDueAsc = (a: ClientItem, b: ClientItem) =>
      (a.dueDate ?? "9999-99-99").localeCompare(b.dueDate ?? "9999-99-99");
    const endWeek = endOfWeek(today);
    const endNextWeek = addDays(endWeek, 7);
    const bucket = (test: (due: string | null) => boolean) =>
      rest.filter((it) => test(it.dueDate)).sort(byDueAsc);
    groups = [
      ...(hasContext
        ? [{ key: "context", label: contextLabel, items: contextItems }]
        : []),
      { key: "overdue", label: "Overdue", items: bucket((d) => d !== null && d < today) },
      { key: "due-today", label: "Due today", items: bucket((d) => d === today) },
      {
        key: "due-week",
        label: "Due this week",
        items: bucket((d) => d !== null && d > today && d <= endWeek),
      },
      {
        key: "due-next-week",
        label: "Due next week",
        items: bucket((d) => d !== null && d > endWeek && d <= endNextWeek),
      },
      {
        key: "later",
        label: "Due later",
        items: bucket((d) => d === null || d > endNextWeek),
      },
    ].filter((g) => g.items.length > 0);
  }

  return (
    <div className="ai-list" ref={listRef}>
      {!isDone && (
        <form className="ai-add" onSubmit={addItem}>
          <input
            type="text"
            placeholder="Add an action item…"
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <DueDatePopover value={newDue} onChange={setNewDue} />
          <RepeatPopover
            value={newRecurrence}
            onChange={(v) => {
              setNewRecurrence(v);
              // A rhythm needs an anchor — default the due date to today.
              if (v && !newDue) setNewDue(today);
            }}
          />
          <PriorityPopover value={newPriority} onChange={setNewPriority} />
          <ProjectPicker
            value={newProjectId}
            projects={projects}
            onChange={setNewProjectId}
            showLabel={false}
          />
          {milestones && milestones.length > 0 && (
            <MilestonePopover
              value={newMilestoneId}
              milestones={milestones}
              onChange={setNewMilestoneId}
            />
          )}
          <button
            type="submit"
            className="ai-add-btn"
            disabled={adding || !content.trim()}
            aria-label="Add"
          >
            +
          </button>
        </form>
      )}

      {groups.length === 0 && (
        <p className="ai-empty">
          {isDone ? "No completed action items." : "No open action items."}
        </p>
      )}

      {groups.map((g) => (
        <div className="ai-group" key={g.key}>
          <div className="ai-group-head">
            {g.label}
            <span className="count">{g.items.length}</span>
          </div>
          <ul className="ai-items">
            {g.items.map((it) => {
              const inlineMeta = metaLayout === "inline";
              const quiet = !isDone && !inlineMeta;
              // The four pickers. Inline mode (Tasks page) shows all of them
              // on the title row. Quiet mode (the rails) keeps only the SET
              // ones in the row — as bare pills / a blue icon — and floats the
              // UNSET ones in a hover overlay so the title never reflows.
              const duePicker = (
                <DueDatePopover
                  key="due"
                  value={it.dueDate}
                  onChange={(v) => patch(it.id, { dueDate: v })}
                />
              );
              const repeatPicker = (
                <RepeatPopover
                  key="repeat"
                  value={
                    it.recurrenceUnit
                      ? {
                          unit: it.recurrenceUnit,
                          interval: it.recurrenceInterval ?? 1,
                        }
                      : null
                  }
                  onChange={(v) =>
                    patch(it.id, {
                      recurrenceUnit: v?.unit ?? null,
                      recurrenceInterval: v?.interval ?? null,
                      // A rhythm needs an anchor — default the due date to today.
                      ...(v && !it.dueDate ? { dueDate: today } : {}),
                    })
                  }
                  showLabel={inlineMeta}
                />
              );
              const prioPicker = (
                <PriorityPopover
                  key="prio"
                  value={it.priority}
                  onChange={(v) => patch(it.id, { priority: v })}
                />
              );
              const projPicker = (
                <ProjectPicker
                  key="proj"
                  value={it.projectId}
                  projects={projects}
                  onChange={(v) => patch(it.id, { projectId: v })}
                  showLabel={inlineMeta}
                />
              );
              const snoozePicker = (
                <SnoozePopover
                  key="snooze"
                  today={today}
                  onSnooze={(until) => snoozeItem(it.id, until)}
                />
              );
              const msPicker =
                milestones && milestones.length > 0 ? (
                  <MilestonePopover
                    key="milestone"
                    value={it.milestoneId}
                    milestones={milestones}
                    onChange={(v) => patch(it.id, { milestoneId: v })}
                  />
                ) : null;
              const waitPicker = people ? (
                <WaitingOnPopover
                  key="wait"
                  personId={it.waitingOnPersonId}
                  freeText={it.ownerName}
                  people={people}
                  onChange={(v) =>
                    patch(it.id, {
                      waitingOnPersonId: v.personId,
                      ownerName: v.name,
                    })
                  }
                />
              ) : null;
              const isWaiting = waitingLabel(it) !== null;
              const setPickers = [
                isWaiting && waitPicker,
                it.dueDate && duePicker,
                it.recurrenceUnit && repeatPicker,
                it.priority && prioPicker,
                it.projectId && projPicker,
                it.milestoneId && msPicker,
              ].filter(Boolean);
              // Snooze is always "unset" on a visible row (an active snooze
              // hides it), so it lives with the hover controls in quiet mode.
              const unsetPickers = [
                !it.dueDate && duePicker,
                !it.recurrenceUnit && repeatPicker,
                !it.priority && prioPicker,
                !it.projectId && projPicker,
                !it.milestoneId && msPicker,
                !isWaiting && waitPicker,
                snoozePicker,
              ].filter(Boolean);
              const meta = !isDone && (
                <div className="ai-meta-row">
                  {quiet
                    ? setPickers
                    : [
                        duePicker,
                        repeatPicker,
                        prioPicker,
                        projPicker,
                        msPicker,
                        waitPicker,
                        snoozePicker,
                      ].filter(Boolean)}
                </div>
              );
              return (
                <li
                  className={`ai-item ${quiet ? "ai-item-quiet" : ""}`}
                  key={it.id}
                >
                  <input
                    type="checkbox"
                    aria-label={isDone ? "Reopen" : "Complete"}
                    checked={isDone}
                    onChange={() => (isDone ? reopen(it.id) : complete(it.id))}
                  />
                  <div className="ai-body">
                    {showProjectPrefix && it.projectId && projectNameById.has(it.projectId) && (
                      <span className="ai-project-prefix">
                        {projectNameById.get(it.projectId)}
                      </span>
                    )}
                    <textarea
                      className="ai-content"
                      rows={1}
                      defaultValue={it.content}
                      ref={autoGrow}
                      onInput={(e) => autoGrow(e.currentTarget)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== it.content) patch(it.id, { content: v });
                      }}
                    />
                    {dependencyInfo?.has(it.id) && (
                      <span
                        className="ai-blocked-icon"
                        title={dependencyInfo.get(it.id)}
                        aria-label={dependencyInfo.get(it.id)}
                      >
                        <StopIcon />
                      </span>
                    )}
                    {meta}
                    {isDone && (
                      <div className="ai-meta-row">
                        <span className="ai-done-date">
                          {it.completedDay ? `Done ${formatDue(it.completedDay)}` : "Done"}
                        </span>
                      </div>
                    )}
                  </div>
                  {quiet && unsetPickers.length > 0 && (
                    <div className="ai-hover-ctls">{unsetPickers}</div>
                  )}
                  <button
                    type="button"
                    className="ai-del"
                    aria-label="Delete"
                    onClick={() => remove(it.id)}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}

      {pendingDeletes.length > 0 && (
        <div className="undo-toasts">
          {pendingDeletes.map((it) => (
            <div className="undo-toast" role="status" key={it.id}>
              <span className="undo-toast-text">
                Deleted “{it.content.length > 40 ? `${it.content.slice(0, 40)}…` : it.content}”
              </span>
              <button
                type="button"
                className="undo-toast-btn"
                onClick={() => undoDelete(it.id)}
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
