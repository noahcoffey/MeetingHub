// Two-sided Project log (signed-off design): center spine, entries alternating
// left/right, typed icon nodes in the kind colors, a Today pill between future
// and past, month chips at boundaries, quiet-gap pills, and a native <details>
// expander past the first 20 entries. Server-rendered — no client JS.
import type { ReactNode } from "react";
import Link from "next/link";
import { APP_TIMEZONE } from "@/lib/dates";

export type LogFutureNode = {
  key: string;
  sortDate: Date;
  dateLabel: string;
  title: ReactNode;
  kind: "deadline" | "meeting" | "milestone";
};

export type LogPastEntry = {
  key: string;
  date: Date;
  kind: "meeting" | "note" | "task" | "milestone";
  title: string;
  sub?: string;
  href?: string;
};

const VISIBLE_PAST = 20;
const GAP_DAYS = 14;

function CalendarIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <rect x="2.5" y="4" width="15" height="13" rx="2" strokeWidth="2" />
      <path d="M6.5 2v4M13.5 2v4M2.5 8.5h15" strokeWidth="2" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M3.5 10.5l4.5 4.5L16.5 5"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function PencilIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path d="M12.5 2.5l5 5L7 18H2v-5z" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}
function PennantIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path d="M5 18V2.5" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M5 3.5h10l-3.2 3.5L15 10.5H5z" fill="currentColor" stroke="none" />
    </svg>
  );
}
function TargetIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="10" cy="10" r="7" strokeWidth="2" />
      <circle cx="10" cy="10" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

const ICONS = {
  meeting: <CalendarIcon />,
  task: <CheckIcon />,
  note: <PencilIcon />,
  milestone: <PennantIcon />,
  deadline: <TargetIcon />,
} as const;

function monthLabel(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    month: "long",
    year: "numeric",
  }).format(d);
}

function daysApart(newer: Date, older: Date): number {
  return Math.round((newer.getTime() - older.getTime()) / 86_400_000);
}

export function ProjectLog({
  future,
  entries,
  todayLabel,
}: {
  future: LogFutureNode[];
  entries: LogPastEntry[]; // newest first, uncapped
  todayLabel: string;
}) {
  if (future.length === 0 && entries.length === 0) {
    return <p className="muted empty-sm">Nothing logged yet.</p>;
  }

  // Top of the spine is the farthest future, reading down through today into
  // the past — so future nodes render farthest-first.
  const futureDesc = [...future].sort(
    (a, b) => b.sortDate.getTime() - a.sortDate.getTime(),
  );

  // Sides alternate across every event row (future + past as one sequence).
  let rowIndex = 0;
  const side = () => (rowIndex++ % 2 === 0 ? "right" : "left");

  const futureRows = futureDesc.map((n) => (
    <div
      className={`plog-row future ${n.kind} ${side()}`}
      key={n.key}
    >
      <span className="plog-node">{ICONS[n.kind]}</span>
      <div className="plog-card">
        <p className="plog-date">{n.dateLabel}</p>
        <p className="plog-title">{n.title}</p>
      </div>
    </div>
  ));

  // Past rows with month chips at boundaries and quiet-gap pills. The month
  // chip is skipped for the newest group (the current context is implied).
  const pastRows = (list: LogPastEntry[], prevTail?: LogPastEntry) => {
    const out: ReactNode[] = [];
    let prev = prevTail;
    for (const e of list) {
      if (prev) {
        const gap = daysApart(prev.date, e.date);
        if (gap >= GAP_DAYS) {
          out.push(
            <div className="plog-mid" key={`gap-${e.key}`}>
              <span className="gap-pill">
                {Math.round(gap / 7)} quiet weeks
              </span>
            </div>,
          );
        }
        const m = monthLabel(e.date);
        if (m !== monthLabel(prev.date)) {
          out.push(
            <div className="plog-mid" key={`month-${e.key}`}>
              <span className="plog-month">{m}</span>
            </div>,
          );
        }
      }
      out.push(
        <div
          className={`plog-row ${e.kind} ${e.kind === "milestone" ? "reached" : ""} ${side()}`}
          key={e.key}
        >
          <span className="plog-node">{ICONS[e.kind]}</span>
          <div className="plog-card">
            <p className="plog-date">
              {new Intl.DateTimeFormat("en-US", {
                timeZone: APP_TIMEZONE,
                month: "short",
                day: "numeric",
              }).format(e.date)}
            </p>
            <p className="plog-title">
              {e.href ? <Link href={e.href}>{e.title}</Link> : e.title}
            </p>
            {e.sub && <p className="plog-sub">{e.sub}</p>}
          </div>
        </div>,
      );
      prev = e;
    }
    return out;
  };

  const visible = entries.slice(0, VISIBLE_PAST);
  const earlier = entries.slice(VISIBLE_PAST);

  return (
    <div className="plog">
      {futureRows}
      {entries.length > 0 && (
        <div className="plog-mid">
          <span className="today-pill">Today · {todayLabel}</span>
        </div>
      )}
      {pastRows(visible)}
      {earlier.length > 0 && (
        <details className="plog-earlier">
          <summary>Show {earlier.length} earlier entries</summary>
          <div className="plog-earlier-rows">
            {pastRows(earlier, visible[visible.length - 1])}
          </div>
        </details>
      )}
    </div>
  );
}
