// Gap-aware line chart for a 1–10 daily signal (server-rendered, no deps).
// A dot on every logged day; the line connects only consecutive logged days, so
// days you didn't journal leave an honest gap. A dashed line marks the average.
// A 7-day trailing moving-average "trend" overlay is always rendered but only shown
// when [data-trend="on"] is set on <html> (toggled + persisted client-side).
const TREND_WINDOW = 7;

export function MetaChart({
  days,
  avg,
  tone,
  min = 1,
  max = 10,
  unit,
}: {
  days: { date: string; value: number | null }[];
  avg: number | null;
  tone: "prod" | "anx" | "neutral" | "open" | "created" | "completed" | "load";
  // Value range (defaults to the 1–10 journal scale; task charts pass 0..dataMax).
  min?: number;
  max?: number;
  // When set (e.g. "h"), the unit is appended to tooltips and min/max y-scale
  // labels are drawn along the left edge so the height is readable.
  unit?: string;
}) {
  const n = days.length;
  const span = max - min || 1;
  // Map value into 6–94 (vertical padding so edge dots aren't clipped).
  const yFor = (v: number) => 6 + (1 - (v - min) / span) * 88;
  const xFor = (i: number) => (n > 1 ? (i / (n - 1)) * 100 : 50);

  const pts = days.map((d, i) => ({
    i,
    date: d.date,
    value: d.value,
    x: xFor(i),
    y: d.value != null ? yFor(d.value) : null,
  }));

  const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a.y != null && b.y != null) {
      segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }
  const dots = pts.filter((p) => p.y != null);
  const avgY = avg != null ? yFor(avg) : null;

  // Trailing moving average — smooths across short gaps; breaks only when no data
  // falls in the trailing window at all.
  let trendPath = "";
  let drawing = false;
  for (let i = 0; i < n; i++) {
    const vals: number[] = [];
    for (let k = Math.max(0, i - (TREND_WINDOW - 1)); k <= i; k++) {
      const v = days[k].value;
      if (v != null) vals.push(v);
    }
    if (vals.length) {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const x = xFor(i);
      const y = yFor(mean);
      trendPath += `${drawing ? " L" : "M"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      drawing = true;
    } else {
      drawing = false;
    }
  }

  return (
    <div className={`report-chart line ${tone}`}>
      <svg
        className="rc-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        {avgY != null && (
          <line
            className="rc-avg"
            x1="0"
            y1={avgY}
            x2="100"
            y2={avgY}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {trendPath && (
          <path
            className="rc-trend"
            d={trendPath}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {segments.map((s, idx) => (
          <line
            key={idx}
            className="rc-line"
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>
      {dots.map((p) => (
        <span
          key={p.i}
          className="rc-dot"
          style={{ left: `${p.x}%`, top: `${p.y}%` }}
          title={`${p.date}: ${p.value}${unit ?? ""}`}
        />
      ))}
      {unit != null && (
        <>
          <span className="rc-scale rc-scale-max">
            {max}
            {unit}
          </span>
          <span className="rc-scale rc-scale-min">
            {min}
            {unit}
          </span>
        </>
      )}
    </div>
  );
}
