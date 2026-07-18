"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const REFRESH_MS = 60_000;

// Keeps the Dashboard's server data (meetings, tasks, next meeting) current without
// a manual reload. Paused while the tab isn't visible; re-syncs immediately on
// return so you're not staring at stale data. router.refresh() only re-fetches the
// server components — client editors (e.g. the yesterday's-journal box) keep
// whatever's being typed, since TipTap only reads its initial content on mount.
export function DashboardAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;

    function start() {
      if (id) return;
      id = setInterval(() => router.refresh(), REFRESH_MS);
    }
    function stop() {
      if (id) clearInterval(id);
      id = null;
    }
    function onVisibility() {
      if (document.visibilityState === "visible") {
        router.refresh();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);

  return null;
}
