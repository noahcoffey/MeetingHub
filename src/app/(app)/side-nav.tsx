"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS } from "./nav-items";

export function SideNav({
  taskOpen,
  taskDueToday,
  disabledFeatures,
}: {
  taskOpen: number;
  taskDueToday: number;
  disabledFeatures: string[];
}) {
  const pathname = usePathname();
  const visible = NAV_ITEMS.filter(
    (it) => !it.feature || !disabledFeatures.includes(it.feature),
  );
  return (
    <nav className="side-nav">
      {visible.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className={`side-link ${it.match(pathname) ? "is-active" : ""}`}
        >
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
            {it.icon}
          </svg>
          <span className="side-label">{it.label}</span>
          {it.href === "/tasks" && (taskOpen > 0 || taskDueToday > 0) && (
            <span className="nav-counts">
              {taskDueToday > 0 && (
                <span
                  className="due-badge"
                  title={`${taskDueToday} due today`}
                  aria-label={`${taskDueToday} due today`}
                >
                  {taskDueToday}
                </span>
              )}
              <span
                className="open-count"
                title={`${taskOpen} open`}
                aria-label={`${taskOpen} open`}
              >
                {taskOpen}
              </span>
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
