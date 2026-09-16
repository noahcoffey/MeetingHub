"use client";

import { useState } from "react";
import Link from "next/link";
import type { Attendee } from "@/db/schema";
import { initials } from "@/lib/initials";

type Entry = { key: string; name: string; email: string; personId: string | null };
type LinkedPerson = { id: string; name: string };

// Attendees arrive from the calendar with every field optional, and a long
// invite list would otherwise run off the page. Collapsed, this is one
// truncating line; clicking opens the full roster with emails.
const COLLAPSED_AVATARS = 4;

function toEntries(
  attendees: Attendee[],
  personByEmail: Record<string, LinkedPerson>,
): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  attendees.forEach((a, i) => {
    const email = (a.email ?? "").trim();
    const name = (a.name ?? "").trim() || email.split("@")[0] || "";
    if (!name && !email) return;
    const key = email.toLowerCase() || name.toLowerCase() || `i${i}`;
    if (seen.has(key)) return;
    seen.add(key);
    // Only an email match: a person linked to this meeting by title (a
    // recurring forum) is not any one of the attendees.
    const person = personByEmail[email.toLowerCase()] ?? null;
    out.push({
      key,
      // The People record is the name the user chose, so it wins over whatever
      // the calendar sent — which is often nothing, leaving the email's local
      // part standing in for a name. The address is still on the expanded row.
      name: person?.name.trim() || name || email,
      email,
      personId: person?.id ?? null,
    });
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

export function Attendees({
  attendees,
  personByEmail = {},
}: {
  attendees: Attendee[];
  /** Lowercased email → person record, for the attendees the workspace knows. */
  personByEmail?: Record<string, LinkedPerson>;
}) {
  const [open, setOpen] = useState(false);
  const entries = toEntries(attendees, personByEmail);
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
              {e.personId ? (
                <Link className="attendee-name attendee-link" href={`/people/${e.personId}`}>
                  {e.name}
                </Link>
              ) : (
                <span className="attendee-name">{e.name}</span>
              )}
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
