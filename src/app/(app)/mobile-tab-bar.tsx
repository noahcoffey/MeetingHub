"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, type NavItem } from "./nav-items";

// Native-style bottom tab bar, shown only on phone widths (CSS hides it
// ≥821px; the desktop sidebar's nav is hidden ≤820px in return). Four
// primary tabs + a "More" sheet for the rest. Disabled workspace features
// drop out and the next enabled item fills the slot.

const PRIMARY_ORDER = ["/", "/meetings", "/tasks", "/projects"];
const MAX_TABS = 5; // 4 primary + More (or 5 items when nothing overflows)

function MoreIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="4.5" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MobileTabBar({
  taskOpen,
  taskDueToday,
  disabledFeatures,
}: {
  taskOpen: number;
  taskDueToday: number;
  disabledFeatures: string[];
}) {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Close the More sheet on navigation.
  useEffect(() => {
    setSheetOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!sheetOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSheetOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheetOpen]);

  const enabled = NAV_ITEMS.filter(
    (it) => !it.feature || !disabledFeatures.includes(it.feature),
  );

  let tabs: NavItem[];
  let more: NavItem[];
  if (enabled.length <= MAX_TABS) {
    tabs = enabled;
    more = [];
  } else {
    tabs = PRIMARY_ORDER.map((href) =>
      enabled.find((it) => it.href === href),
    ).filter((it): it is NavItem => it !== undefined);
    const rest = enabled.filter((it) => !tabs.includes(it));
    while (tabs.length < MAX_TABS - 1 && rest.length > 0) {
      tabs.push(rest.shift() as NavItem);
    }
    more = rest;
  }
  const moreActive = more.some((it) => it.match(pathname));

  return (
    <>
      <nav className="mobile-tabs" aria-label="Primary">
        {tabs.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={`mobile-tab ${it.match(pathname) ? "is-active" : ""}`}
          >
            <span className="mobile-tab-icon">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
                {it.icon}
              </svg>
              {it.href === "/tasks" && taskDueToday > 0 && (
                <span
                  className="mobile-tab-badge"
                  aria-label={`${taskDueToday} due today`}
                >
                  {taskDueToday}
                </span>
              )}
            </span>
            <span className="mobile-tab-label">{it.label}</span>
          </Link>
        ))}
        {more.length > 0 && (
          <button
            type="button"
            className={`mobile-tab ${moreActive ? "is-active" : ""}`}
            onClick={() => setSheetOpen((o) => !o)}
            aria-expanded={sheetOpen}
          >
            <span className="mobile-tab-icon">
              <MoreIcon />
            </span>
            <span className="mobile-tab-label">More</span>
          </button>
        )}
      </nav>

      {sheetOpen && (
        <div
          className="mobile-sheet-overlay"
          onMouseDown={() => setSheetOpen(false)}
        >
          <div
            className="mobile-sheet"
            role="dialog"
            aria-label="More sections"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mobile-sheet-grip" aria-hidden />
            {more.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={`mobile-sheet-link ${it.match(pathname) ? "is-active" : ""}`}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
                  {it.icon}
                </svg>
                <span>{it.label}</span>
                {it.href === "/tasks" && taskOpen > 0 && (
                  <span className="open-count">{taskOpen}</span>
                )}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
