"use client";

import { useEffect } from "react";

// Minimal shapes for the CSS Custom Highlight API (not in every TS lib version).
type HighlightRegistry = {
  set(key: string, value: unknown): void;
  delete(key: string): void;
};
type HighlightCtor = new (...ranges: Range[]) => unknown;

const KEY = "mh-search";

function applyHighlights(container: HTMLElement, terms: string[]) {
  const reg = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
  const Ctor = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight;
  if (!reg || !Ctor) return; // unsupported browser → no-op

  reg.delete(KEY);
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const lower = (node.nodeValue ?? "").toLowerCase();
    for (const term of terms) {
      let idx = lower.indexOf(term);
      while (idx !== -1) {
        const range = document.createRange();
        range.setStart(node, idx);
        range.setEnd(node, idx + term.length);
        ranges.push(range);
        idx = lower.indexOf(term, idx + term.length);
      }
    }
    node = walker.nextNode();
  }
  if (ranges.length) reg.set(KEY, new Ctor(...ranges));
}

// Highlights the matched search term(s) across the meeting view (title, notes,
// generated notes, description, action items). Uses the Highlight API so it
// never mutates the editor's content.
export function SearchHighlighter({ query }: { query: string }) {
  useEffect(() => {
    const terms = Array.from(
      new Set(
        (query.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
          (t) => t.length >= 2,
        ),
      ),
    );
    const reg = (CSS as unknown as { highlights?: HighlightRegistry }).highlights;
    if (terms.length === 0) return;
    const container = document.querySelector(
      ".meeting-workspace",
    ) as HTMLElement | null;
    if (!container) return;

    const run = () => applyHighlights(container, terms);
    run();
    // Re-run a few times as the editors hydrate their content asynchronously.
    const timers = [150, 400, 900, 1800].map((d) => window.setTimeout(run, d));
    return () => {
      timers.forEach((t) => clearTimeout(t));
      reg?.delete(KEY);
    };
  }, [query]);

  return null;
}
