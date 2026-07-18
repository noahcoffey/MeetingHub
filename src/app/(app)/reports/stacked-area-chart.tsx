// Stacked area of the open-task backlog (server-rendered, no deps). Total height =
// open tasks; split into "Carried over" (older) and "New" (created this period).
export type StackPoint = { date: string; carried: number; total: number };

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

  const carriedTop = days
    .map((d, i) => `${i === 0 ? "M" : "L"} ${xFor(i).toFixed(2)} ${yFor(d.carried).toFixed(2)}`)
    .join(" ");
  const totalTop = days.map((d, i) => ({ x: xFor(i), y: yFor(d.total) }));

  // Lower band: 0 → carried.
  const carriedArea = `${carriedTop} L ${xFor(n - 1).toFixed(2)} ${BASE} L ${xFor(0).toFixed(2)} ${BASE} Z`;

  // Upper band: carried → total (carried line L→R, then total line R→L).
  const totalRev = [...totalTop]
    .reverse()
    .map((p) => `L ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");
  const newArea = `${carriedTop} ${totalRev} Z`;

  const totalLine = totalTop
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(" ");

  return (
    <div className="report-chart stacked">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
        <path className="sa-carried" d={carriedArea} />
        <path className="sa-new" d={newArea} />
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
