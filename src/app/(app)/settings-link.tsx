"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Settings nav link, rendered in the sidebar foot (below the theme toggle).
export function SettingsLink({ count = 0 }: { count?: number }) {
  const pathname = usePathname();
  const active = pathname.startsWith("/settings");
  return (
    <Link href="/settings" className={`side-link ${active ? "is-active" : ""}`}>
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
        <circle cx="10" cy="10" r="2.4" strokeWidth="1.5" />
        <path
          d="M10 2.5v2M10 15.5v2M17.5 10h-2M4.5 10h-2M15.3 4.7l-1.4 1.4M6.1 13.9l-1.4 1.4M15.3 15.3l-1.4-1.4M6.1 6.1L4.7 4.7"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
      <span className="side-label">Settings</span>
      {count > 0 && (
        <span
          className="nav-counts"
          title={`${count} incoming note${count === 1 ? "" : "s"} to review`}
        >
          <span className="due-badge">{count}</span>
        </span>
      )}
    </Link>
  );
}
