"use client";

import { useState } from "react";
import type { Attendee } from "@/db/schema";
import { initials } from "@/lib/initials";

type Entry = { key: string; name: string; email: string };

// Attendees arrive from the calendar with every field optional, and a long
// invite list would otherwise run off the page. Collapsed, this is one
// truncating line; clicking opens the full roster with emails.
const COLLAPSED_AVATARS = 4;

function toEntries(attendees: Attendee[]): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  attendees.forEach((a, i) => {
    const email = (a.email ?? "").trim();
    const name = (a.name ?? "").trim() || email.split("@")[0] || "";
    if (!name && !email) return;
    const key = email.toLowerCase() || name.toLowerCase() || `i${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ key, name: name || email, email });
  });
  return out;
}

function Avatar({ entry }: { entry: Entry }) {
  return (
    <span className="attendee-avatar" aria-hidden="true">
      {initials(entry.name)}
    </span>
  );
}

export function Attendees({ attendees }: { attendees: Attendee[] }) {
  const [open, setOpen] = useState(false);
  const entries = toEntries(attendees);
  if (entries.length === 0) return null;

  const shown = entries.slice(0, COLLAPSED_AVATARS);
  const rest = entries.length - shown.length;

  return (
    <div className="attendees">
      <button
        type="button"
        className="attendees-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="attendee-stack">
          {shown.map((e) => (
            <Avatar key={e.key} entry={e} />
          ))}
        </span>
        <span className="attendees-label">
          {shown.map((e) => e.name).join(", ")}
        </span>
        {rest > 0 && <span className="attendees-rest">+{rest} more</span>}
        <svg
          className={`attendees-chevron${open ? " is-open" : ""}`}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            d="M4 6l4 4 4-4"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <ul className="attendee-list">
          {entries.map((e) => (
            <li key={e.key} className="attendee-row">
              <Avatar entry={e} />
              <span className="attendee-name">{e.name}</span>
              {e.email && e.email !== e.name && (
                <span className="attendee-email">{e.email}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
