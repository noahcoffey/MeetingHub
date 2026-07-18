"use client";

import { useEffect, useRef, useState } from "react";
import { useSaveReport } from "../save-status";

export type ClientStat = {
  id: string;
  name: string;
  type: "scale" | "number" | "boolean" | "text";
  direction: "good" | "bad" | "neutral";
  config: {
    labels?: string[];
    min?: number;
    max?: number;
    unit?: string;
    placeholder?: string;
  };
  numValue: number | null;
  textValue: string | null;
};

// Direction → color tone (reuses the existing prod/anx accents).
function toneFor(direction: ClientStat["direction"]): string {
  if (direction === "good") return "prod";
  if (direction === "bad") return "anx";
  return "neutral";
}

// Labeled 1..N scale. Click the active option again to clear it.
function ScaleField({
  label,
  labels,
  tone,
  value,
  onChange,
}: {
  label: string;
  labels: string[];
  tone: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="meta-field">
      <label className="meta-label">{label}</label>
      <div className={`meta-scale ${tone}`} role="group" aria-label={label}>
        {labels.map((opt, i) => {
          const v = i + 1;
          const active = value === v;
          return (
            <button
              type="button"
              key={`${opt}-${i}`}
              className={`meta-opt ${active ? "on" : ""}`}
              aria-pressed={active}
              onClick={() => onChange(active ? null : v)}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BooleanField({
  label,
  tone,
  value,
  onChange,
}: {
  label: string;
  tone: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="meta-field">
      <label className="meta-label">{label}</label>
      <div className={`meta-scale ${tone}`} role="group" aria-label={label}>
        {[
          { txt: "No", v: 0 },
          { txt: "Yes", v: 1 },
        ].map(({ txt, v }) => {
          const active = value === v;
          return (
            <button
              type="button"
              key={txt}
              className={`meta-opt ${active ? "on" : ""}`}
              aria-pressed={active}
              onClick={() => onChange(active ? null : v)}
            >
              {txt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function NumberField({
  label,
  min,
  max,
  unit,
  value,
  onChange,
}: {
  label: string;
  min?: number;
  max?: number;
  unit?: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <div className="meta-field">
      <label className="meta-label">{label}</label>
      <div className="meta-number-row">
        <input
          type="number"
          className="meta-number"
          value={value ?? ""}
          min={min}
          max={max}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? null : Number(raw));
          }}
        />
        {unit ? <span className="meta-unit">{unit}</span> : null}
      </div>
    </div>
  );
}

function TextField({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="meta-field">
      <label className="meta-label">{label}</label>
      <textarea
        className="meta-text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// Renders the workspace's active journal stats and autosaves each change to the
// entry as { stats: { [statId]: value } }. Editor-agnostic: any stat type.
export function JournalMeta({
  entryId,
  stats,
}: {
  entryId: string;
  stats: ClientStat[];
}) {
  const report = useSaveReport();
  // num values keyed by stat id; text values kept separately.
  const [nums, setNums] = useState<Record<string, number | null>>(() =>
    Object.fromEntries(stats.map((s) => [s.id, s.numValue])),
  );
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(stats.map((s) => [s.id, s.textValue ?? ""])),
  );
  const pending = useRef<Record<string, number | boolean | string | null>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => report("meta", "saved"), [report]);

  function flush() {
    const patch = pending.current;
    pending.current = {};
    if (Object.keys(patch).length === 0) return;
    report("meta", "saving");
    fetch(`/api/journal-entries/${entryId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stats: patch }),
    })
      .then((res) => report("meta", res.ok ? "saved" : "dirty"))
      .catch(() => report("meta", "dirty"));
  }

  function queue(statId: string, value: number | boolean | string | null) {
    pending.current[statId] = value;
    report("meta", "dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }

  if (stats.length === 0) {
    return (
      <div className="journal-meta">
        <p className="muted empty-sm">
          No stats yet. Add some under Settings → Journal stats.
        </p>
      </div>
    );
  }

  return (
    <div className="journal-meta">
      {stats.map((s) => {
        const tone = toneFor(s.direction);
        if (s.type === "scale") {
          return (
            <ScaleField
              key={s.id}
              label={s.name}
              labels={s.config.labels ?? ["1", "2", "3", "4", "5"]}
              tone={tone}
              value={nums[s.id] ?? null}
              onChange={(v) => {
                setNums((m) => ({ ...m, [s.id]: v }));
                queue(s.id, v);
              }}
            />
          );
        }
        if (s.type === "boolean") {
          return (
            <BooleanField
              key={s.id}
              label={s.name}
              tone={tone}
              value={nums[s.id] ?? null}
              onChange={(v) => {
                setNums((m) => ({ ...m, [s.id]: v }));
                queue(s.id, v === null ? null : v === 1);
              }}
            />
          );
        }
        if (s.type === "number") {
          return (
            <NumberField
              key={s.id}
              label={s.name}
              min={s.config.min}
              max={s.config.max}
              unit={s.config.unit}
              value={nums[s.id] ?? null}
              onChange={(v) => {
                setNums((m) => ({ ...m, [s.id]: v }));
                queue(s.id, v);
              }}
            />
          );
        }
        return (
          <TextField
            key={s.id}
            label={s.name}
            placeholder={s.config.placeholder}
            value={texts[s.id] ?? ""}
            onChange={(v) => {
              setTexts((m) => ({ ...m, [s.id]: v }));
              queue(s.id, v);
            }}
          />
        );
      })}
    </div>
  );
}
