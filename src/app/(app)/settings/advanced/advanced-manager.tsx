"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function SwitchRow({
  title,
  description,
  checked,
  disabled,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="switch-row">
      <div className="switch-text">
        <div className="switch-title">{title}</div>
        <p className="muted switch-desc">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        className={`switch ${checked ? "on" : ""}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
    </div>
  );
}

export function AdvancedManager({
  initialHideGenerated,
}: {
  initialHideGenerated: boolean;
}) {
  const router = useRouter();
  const [hideGenerated, setHideGenerated] = useState(initialHideGenerated);
  const [saving, setSaving] = useState(false);

  async function save(
    body: { hideGeneratedNotes: boolean },
    rollback: () => void,
  ) {
    setSaving(true);
    try {
      const res = await fetch("/api/app-settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      // Re-render server components so the hiding applies everywhere at once.
      router.refresh();
    } catch {
      rollback();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="advanced-settings">
      <p className="muted settings-intro">
        Power-user switches. You found this by holding <kbd>A</kbd> — it stays
        out of the menu otherwise.
      </p>
      <div className="switch-stack">
        <SwitchRow
          title="Hide generated notes"
          description="Hides all generated notes and Notes+ references —
            the generated section on meetings, Notes+ badges, past-meeting
            excerpts, and search matches — plus the Incoming notes screen.
            Your own notes are untouched, and incoming pushes keep being
            stored; turning this off brings everything back."
          checked={hideGenerated}
          disabled={saving}
          onChange={(next) => {
            setHideGenerated(next);
            void save({ hideGeneratedNotes: next }, () => setHideGenerated(!next));
          }}
        />
      </div>
    </div>
  );
}
