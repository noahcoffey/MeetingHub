// Stacked area of the open-task backlog (server-rendered, no deps). Total height =
// open tasks at end of day; the top band is the tasks created that day.
export type StackPoint = { date: string; added: number; total: number };

export function StackedAreaChart({
  days,
  max,
}: {
  days: StackPoint[];
  max: number;
}) {
  const n = days.length;
  const span = max || 1;
  const xFor = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);
  const yFor = (v: number) => 6 + (1 - v / span) * 88;
  const BASE = yFor(0);

  const baseTop = days
    .map(
      (d, i) =>
        `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(d.total - d.added).toFixed(2)}`,
    )
    .join(" ");
  const totalTop = days.map((d, i) => ({ x: xFor(i), y: yFor(d.total) }));

  // Lower band: 0 → open backlog (minus the day's additions).
  const baseArea = `${baseTop} L ${xFor(n - 1).toFixed(2)} ${BASE} L ${xFor(0).toFixed(2)} ${BASE} Z`;

  // Upper band: the day's additions (base line L→R, then total line R→L).
  const totalRev = [...totalTop]
    .reverse()
    .map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
  const addedArea = `${baseTop} ${totalRev} Z`;

  const totalLine = totalTop
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  return (
    <div className="report-chart stacked">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path className="sa-open" d={baseArea} />
        <path className="sa-added" d={addedArea} />
        <path
          className="sa-line"
          d={totalLine}
          fill="none"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
