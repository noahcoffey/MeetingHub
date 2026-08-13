"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// A floating palette for how the project bubbles look. It writes the `--pg-*`
// custom properties inline on the map stage (which beats every stylesheet rule,
// so it wins in both overview and focus mode) and feeds the two spacing numbers
// back to the layout.
//
// Two audiences, one control. As a **tuning tool**, the readout at the bottom
// emits the exact CSS and layout constants, so a look worked out on screen can
// be pasted straight into globals.css / project-graph-layout.ts as the new
// shipped defaults. As a **preference**, anything changed here persists to
// localStorage for this browser and survives reloads — so it never has to be
// re-dialled. Nothing is stored while the values match the defaults, which
// means changing the shipped defaults still reaches anyone who hasn't
// customised.

export type StyleLabValues = {
  /** Bubble diameter, rem. */
  size: number;
  /** Label size, rem. */
  fontSize: number;
  fontWeight: number;
  /** Focused bubble's weight, so it can still stand out from a bold base. */
  fontWeightCentre: number;
  lineHeight: number;
  /** Horizontal padding inside the circle, rem. */
  padX: number;
  /** Border thickness, px. */
  borderWidth: number;
  /** Letter spacing, em. */
  letterSpacing: number;
  /** Max label lines before clipping. */
  clamp: number;
  /** Distance between tree rings, px. */
  ringGap: number;
  /** Vertical squash of each ring, 1 = perfectly circular rings. */
  squash: number;
};

// The shipped look, mirroring globals.css and the layout module. Keep the three
// in sync when applying a config from the readout.
export const STYLE_LAB_DEFAULTS: StyleLabValues = {
  size: 7.9,
  fontSize: 1.5,
  fontWeight: 900,
  fontWeightCentre: 700,
  lineHeight: 1.25,
  padX: 0.1,
  borderWidth: 3,
  letterSpacing: 0,
  clamp: 3,
  ringGap: 190,
  squash: 0.88,
};

type Field = {
  key: keyof StyleLabValues;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

const FIELDS: Field[] = [
  { key: "size", label: "Circle size", min: 4, max: 14, step: 0.1, unit: "rem" },
  { key: "fontSize", label: "Font size", min: 0.6, max: 1.8, step: 0.01, unit: "rem" },
  { key: "fontWeight", label: "Font weight", min: 300, max: 900, step: 100, unit: "" },
  { key: "fontWeightCentre", label: "Focused weight", min: 300, max: 900, step: 100, unit: "" },
  { key: "lineHeight", label: "Line spacing", min: 0.9, max: 2, step: 0.05, unit: "" },
  { key: "padX", label: "Inner padding", min: 0, max: 2.5, step: 0.05, unit: "rem" },
  { key: "borderWidth", label: "Border", min: 0, max: 8, step: 1, unit: "px" },
  { key: "letterSpacing", label: "Letter spacing", min: -0.05, max: 0.2, step: 0.005, unit: "em" },
  { key: "clamp", label: "Max lines", min: 1, max: 6, step: 1, unit: "" },
  { key: "ringGap", label: "Ring spacing", min: 90, max: 420, step: 2, unit: "px" },
  { key: "squash", label: "Ring squash", min: 0.3, max: 1.2, step: 0.01, unit: "" },
];

const STORAGE_KEY = "mh.map.bubble-style.v1";

const RANGE = new Map(FIELDS.map((f) => [f.key, { min: f.min, max: f.max }]));

// Every number entering state goes through here. A cleared number input yields
// `Number("") === 0` and a partial one like "-" yields NaN; unchecked, `size: 0`
// collapses every bubble and `ringGap: NaN` produces non-finite positions, which
// makes nodes vanish from the canvas entirely.
function clampValue(key: keyof StyleLabValues, n: number): number {
  if (!Number.isFinite(n)) return STYLE_LAB_DEFAULTS[key];
  const range = RANGE.get(key);
  return range ? Math.min(range.max, Math.max(range.min, n)) : n;
}

// Stored blobs are untrusted: hand-edited, written by an older build, or simply
// corrupt. Anything that isn't a finite number falls back to the shipped value,
// which also covers a field that didn't exist when the blob was written.
function sanitise(raw: unknown): StyleLabValues {
  const next = { ...STYLE_LAB_DEFAULTS };
  if (typeof raw !== "object" || raw === null) return next;
  const source = raw as Record<string, unknown>;
  for (const key of Object.keys(STYLE_LAB_DEFAULTS) as (keyof StyleLabValues)[]) {
    const candidate = source[key];
    if (typeof candidate === "number") next[key] = clampValue(key, candidate);
  }
  return next;
}

function sameAsDefaults(v: StyleLabValues): boolean {
  return (Object.keys(STYLE_LAB_DEFAULTS) as (keyof StyleLabValues)[]).every(
    (k) => v[k] === STYLE_LAB_DEFAULTS[k],
  );
}

// Values plus a setter that persists. Reading happens in an effect rather than
// a lazy initialiser because this component still server-renders, where there
// is no localStorage — so the first paint is the shipped look and a stored
// override lands immediately after.
export function useBubbleStyle(): [
  StyleLabValues,
  (next: StyleLabValues) => void,
] {
  const [values, setValues] = useState<StyleLabValues>(STYLE_LAB_DEFAULTS);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      setValues(sanitise(JSON.parse(raw) as unknown));
    } catch {
      // Unparseable or unavailable storage is not worth breaking the map over.
    }
  }, []);

  const update = useCallback((next: StyleLabValues) => {
    setValues(next);
    try {
      if (sameAsDefaults(next)) window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Private mode / quota — the change still applies for this session.
    }
  }, []);

  return [values, update];
}

// The custom properties the palette drives, in the same order as the CSS.
export function cssVarsFor(v: StyleLabValues): Record<string, string> {
  return {
    "--pg-size": `${v.size}rem`,
    "--pg-font-size": `${v.fontSize}rem`,
    "--pg-font-weight": String(v.fontWeight),
    "--pg-font-weight-centre": String(v.fontWeightCentre),
    "--pg-line-height": String(v.lineHeight),
    "--pg-pad-x": `${v.padX}rem`,
    "--pg-border-width": `${v.borderWidth}px`,
    "--pg-letter-spacing": `${v.letterSpacing}em`,
    "--pg-clamp": String(v.clamp),
  };
}

function readout(v: StyleLabValues): string {
  return [
    "// paste this back to Claude",
    JSON.stringify(v, null, 2),
    "",
    "/* globals.css — .pg-node */",
    ...Object.entries(cssVarsFor(v)).map(([k, val]) => `${k}: ${val};`),
    "",
    "/* project-graph-layout.ts */",
    `const RING_GAP = ${v.ringGap};`,
    `const SQUASH = ${v.squash};`,
  ].join("\n");
}

export function MapStyleLab({
  values,
  onChange,
  stageRef,
}: {
  values: StyleLabValues;
  onChange: (next: StyleLabValues) => void;
  stageRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Push the properties onto the stage element. Inline beats the stylesheet,
  // which is what makes the palette authoritative over the shipped rules.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const vars = cssVarsFor(values);
    for (const [k, val] of Object.entries(vars)) el.style.setProperty(k, val);
    return () => {
      for (const k of Object.keys(vars)) el.style.removeProperty(k);
    };
  }, [values, stageRef]);

  const set = (key: keyof StyleLabValues, n: number) =>
    onChange({ ...values, [key]: clampValue(key, n) });

  if (!open) {
    return (
      <button
        type="button"
        className="stylelab-fab"
        onClick={() => setOpen(true)}
        title="Bubble style"
      >
        Style
      </button>
    );
  }

  return (
    <div className="stylelab">
      <div className="stylelab-head">
        <strong>Bubble style</strong>
        <span className="muted stylelab-note">
          {sameAsDefaults(values) ? "defaults" : "saved for this browser"}
        </span>
        <button
          type="button"
          className="row-action"
          onClick={() => onChange(STYLE_LAB_DEFAULTS)}
        >
          Reset
        </button>
        <button type="button" className="note-remove" onClick={() => setOpen(false)}>
          ✕
        </button>
      </div>

      <div className="stylelab-fields">
        {FIELDS.map((f) => (
          // A row holds two controls for one setting, and a <label> can name
          // only one — so the row is a named group and each input carries its
          // own label.
          <div
            key={f.key}
            className="stylelab-row"
            role="group"
            aria-label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`}
          >
            <span className="stylelab-label" aria-hidden="true">
              {f.label}
            </span>
            <input
              type="range"
              aria-label={`${f.label} slider`}
              min={f.min}
              max={f.max}
              step={f.step}
              value={values[f.key]}
              onChange={(e) => set(f.key, Number(e.target.value))}
            />
            <input
              type="number"
              aria-label={`${f.label} value`}
              className="stylelab-num"
              min={f.min}
              max={f.max}
              step={f.step}
              value={values[f.key]}
              onChange={(e) => set(f.key, Number(e.target.value))}
            />
            <span className="stylelab-unit" aria-hidden="true">
              {f.unit}
            </span>
          </div>
        ))}
      </div>

      <textarea
        ref={textRef}
        className="stylelab-out"
        readOnly
        value={readout(values)}
        onFocus={(e) => e.currentTarget.select()}
        spellCheck={false}
      />
      <button
        type="button"
        className="ghost-btn ghost-btn-sm stylelab-copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(readout(values));
          } catch {
            textRef.current?.select();
            return;
          }
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy config"}
      </button>
    </div>
  );
}
