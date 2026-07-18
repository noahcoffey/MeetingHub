"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/settings/hidden", label: "Hidden meetings" },
  { href: "/settings/skipped", label: "Skipped meetings" },
  { href: "/settings/incoming", label: "Incoming notes" },
  { href: "/settings/journal-stats", label: "Journal stats" },
  { href: "/settings/calendars", label: "Calendars" },
  { href: "/settings/security", label: "Security" },
  { href: "/settings/tokens", label: "API tokens" },
  { href: "/settings/workspaces", label: "Workspaces" },
];

export function SettingsNav({
  incomingCount = 0,
  hideIncoming = false,
}: {
  incomingCount?: number;
  hideIncoming?: boolean;
}) {
  const pathname = usePathname();

  // Easter-egg entry to Advanced: the item exists only while "A" is held
  // (and while you're on the page itself, so its active state isn't orphaned).
  const [aHeld, setAHeld] = useState(false);
  useEffect(() => {
    const isEditable = (t: EventTarget | null) =>
      t instanceof HTMLElement &&
      (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    const down = (e: KeyboardEvent) => {
      if (
        (e.key === "a" || e.key === "A") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !isEditable(e.target)
      ) {
        setAHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "a" || e.key === "A") setAHeld(false);
    };
    const clear = () => setAHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  const visibleLinks = links.filter(
    (l) => !(hideIncoming && l.href === "/settings/incoming"),
  );
  const showAdvanced = aHeld || pathname === "/settings/advanced";

  return (
    <nav className="settings-nav">
      {visibleLinks.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          className={`settings-nav-link ${pathname === l.href ? "is-active" : ""}`}
        >
          <span>{l.label}</span>
          {l.href === "/settings/incoming" && incomingCount > 0 && (
            <span className="nav-pill">{incomingCount}</span>
          )}
        </Link>
      ))}
      {showAdvanced && (
        <Link
          href="/settings/advanced"
          className={`settings-nav-link ${pathname === "/settings/advanced" ? "is-active" : ""}`}
        >
          <span>Advanced</span>
        </Link>
      )}
    </nav>
  );
}
