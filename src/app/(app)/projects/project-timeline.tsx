// Station-line timeline: the Overview tab's lead box. One line per project,
// milestones as stations (reached = filled green, overdue = danger ring),
// the deadline as a dashed ring, labels below by default flipping above only
// when neighbors would collide. Server-rendered — pure positioning math.
import type { Project } from "@/db/schema";
import type { MilestoneWithProgress } from "@/lib/milestones";
import { shiftDate } from "@/lib/dates";

type Station = {
  key: string;
  x: number; // 0-100 within the window
  name: string;
  dateStr: string;
  kind: "reached" | "late" | "open" | "deadline";
  sub: string;
};

function formatShortDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

// Calendar-day difference b − a between YYYY-MM-DD strings.
function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function ProjectTimeline({
  project,
  milestones,
  today,
}: {
  project: Project;
  milestones: MilestoneWithProgress[];
  today: string;
}) {
  const dated = milestones.filter((m) => m.dueDate !== null);
  const dates = [
    ...dated.map((m) => m.dueDate as string),
    ...(project.deadline ? [project.deadline] : []),
  ].sort();
  // Nothing dated to plot → no box at all.
  if (dates.length === 0) return null;

  // Same padding math as the /projects runway: a week of room left of today
  // (more if something is further overdue), at least four weeks out.
  const first = dates[0];
  const last = dates[dates.length - 1];
  const start = shiftDate(today, Math.min(-7, daysBetween(today, first) - 4));
  const end = shiftDate(today, Math.max(daysBetween(today, last) + 5, 28));
  const span = daysBetween(start, end);
  const x = (d: string) =>
    Math.min(100, Math.max(0, (daysBetween(start, d) / span) * 100));

  const stations: Station[] = [
    ...dated.map((m): Station => {
      const due = m.dueDate as string;
      const kind =
        m.completedAt !== null ? "reached" : due < today ? "late" : "open";
      const progress =
        kind !== "reached" && m.totalTaskCount > 0
          ? ` · ${m.doneTaskCount}/${m.totalTaskCount}`
          : "";
      const sub =
        kind === "reached"
          ? `${formatShortDateStr(due)} ✓`
          : kind === "late"
            ? `${formatShortDateStr(due)} · overdue`
            : `${formatShortDateStr(due)}${progress}`;
      return { key: `m-${m.id}`, x: x(due), name: m.name, dateStr: due, kind, sub };
    }),
    ...(project.deadline
      ? [
          {
            key: "deadline",
            x: x(project.deadline),
            name: "Deadline",
            dateStr: project.deadline,
            kind: "deadline" as const,
            sub: formatShortDateStr(project.deadline),
          },
        ]
      : []),
  ].sort((a, b) => a.x - b.x);

  // Labels sit below by default and flip above only when they'd collide with
  // the previous label in the same band. ~12% of the window is roughly one
  // caption width on a typical hub card; good enough without measuring text.
  const COLLIDE = 12;
  let prevBelow = -Infinity;
  let prevAbove = -Infinity;
  const placed = stations.map((s) => {
    if (s.x - prevBelow >= COLLIDE) {
      prevBelow = s.x;
      return { ...s, band: "below" as const };
    }
    if (s.x - prevAbove >= COLLIDE) {
      prevAbove = s.x;
      return { ...s, band: "above" as const };
    }
    // Third station in a pile-up: accept the overlap below (rare).
    prevBelow = s.x;
    return { ...s, band: "below" as const };
  });
  const hasAbove = placed.some((s) => s.band === "above");

  // The fill advances through the latest reached station.
  const reachedXs = placed.filter((s) => s.kind === "reached").map((s) => s.x);
  const fillPct = reachedXs.length ? Math.max(...reachedXs) : 0;

  // Keep captions from clipping outside the card at the extremes.
  const capX = (v: number) => Math.min(95, Math.max(5, v));
  const weekW = (7 / span) * 100;

  const cap = (s: (typeof placed)[number]) => (
    <span
      key={s.key}
      className={`ptl-cap ${s.kind === "reached" ? "reached" : ""} ${
        s.kind === "late" || s.kind === "deadline" ? "late" : ""
      }`}
      style={{ left: `${capX(s.x)}%` }}
    >
      <b>{s.name}</b>
      {s.sub}
    </span>
  );

  return (
    <section className="hub-card ptl-card">
      <h2>
        Timeline{" "}
        <small>
          {formatShortDateStr(start)} – {formatShortDateStr(end)}
        </small>
      </h2>
      <div
        className="ptl-body"
        style={
          {
            "--today-x": `${x(today)}%`,
            "--week-w": `${weekW}%`,
          } as React.CSSProperties
        }
      >
        {hasAbove && (
          <div className="ptl-band ptl-band-above">
            {placed.filter((s) => s.band === "above").map(cap)}
          </div>
        )}
        <div className="ptl-row">
          <span className="ptl-grid" />
          {placed
            .filter((s) => s.band === "above")
            .map((s) => (
              <span
                key={`tick-${s.key}`}
                className="ptl-tick"
                style={{ left: `${s.x}%` }}
              />
            ))}
          <span className="ptl-line">
            {fillPct > 0 && <i style={{ width: `${fillPct}%` }} />}
          </span>
          {placed.map((s) => (
            <span
              key={`node-${s.key}`}
              className={`ptl-node ${s.kind}`}
              style={{ left: `${s.x}%` }}
              title={`${s.name} — ${s.sub}`}
            />
          ))}
        </div>
        <div className="ptl-band ptl-band-below">
          {placed.filter((s) => s.band === "below").map(cap)}
        </div>
      </div>
    </section>
  );
}
