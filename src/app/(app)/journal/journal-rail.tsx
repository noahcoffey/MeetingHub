"use client";

import { useState } from "react";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`rail-chevron ${open ? "open" : ""}`}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      aria-hidden
    >
      <path d="M7 5l5 5-5 5" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Right rail for the journal: Meta on top (priority — sized to show all its
// fields) over Action items, which take the remaining scrollable space.
export function JournalRail({
  meta,
  children,
}: {
  meta: React.ReactNode;
  children: React.ReactNode;
}) {
  const [metaOpen, setMetaOpen] = useState(true);
  const [itemsOpen, setItemsOpen] = useState(true);

  return (
    <div className="rail-sections">
      <section
        className={`rail-section meta-section ${metaOpen ? "open" : "collapsed"}`}
      >
        <button
          type="button"
          className="rail-section-head"
          onClick={() => setMetaOpen((o) => !o)}
          aria-expanded={metaOpen}
        >
          <Chevron open={metaOpen} />
          Meta
        </button>
        {metaOpen && <div className="rail-section-body">{meta}</div>}
      </section>

      <section
        className={`rail-section weight-1 ${itemsOpen ? "open" : "collapsed"}`}
      >
        <button
          type="button"
          className="rail-section-head"
          onClick={() => setItemsOpen((o) => !o)}
          aria-expanded={itemsOpen}
        >
          <Chevron open={itemsOpen} />
          Action items
        </button>
        {itemsOpen && <div className="rail-section-body">{children}</div>}
      </section>
    </div>
  );
}
