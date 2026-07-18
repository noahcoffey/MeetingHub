"use client";

import { useEffect, useRef, useState } from "react";

// Quick reference for the syntax the live-markdown editor understands
// (StarterKit + task lists + tiptap-markdown).
const ITEMS: { syntax: string; label: string }[] = [
  { syntax: "# Heading", label: "Title" },
  { syntax: "## Subhead", label: "Section" },
  { syntax: "**bold**", label: "Bold" },
  { syntax: "*italic*", label: "Italic" },
  { syntax: "~~strike~~", label: "Strikethrough" },
  { syntax: "`code`", label: "Inline code" },
  { syntax: "```", label: "Code block" },
  { syntax: "- item", label: "Bullet list" },
  { syntax: "1. item", label: "Numbered list" },
  { syntax: "- [ ] task", label: "Checklist" },
  { syntax: "> quote", label: "Blockquote" },
  { syntax: "---", label: "Divider" },
];

// A small "?" affordance that floats in the bottom-right of the notes pane and
// pops a markdown cheat sheet. Anchored to .notes-pane (not the scroll area), so
// it stays put as the notes scroll.
export function MarkdownHelp() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="md-help" ref={wrapRef}>
      {open && (
        <div className="md-help-pop" role="dialog" aria-label="Markdown guide">
          <div className="md-help-head">Markdown guide</div>
          <ul className="md-help-list">
            {ITEMS.map((it) => (
              <li className="md-help-row" key={it.label}>
                <code className="md-help-syntax">{it.syntax}</code>
                <span className="md-help-label">{it.label}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        className={`md-help-btn ${open ? "is-open" : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Markdown formatting guide"
        title="Markdown formatting guide"
      >
        ?
      </button>
    </div>
  );
}
