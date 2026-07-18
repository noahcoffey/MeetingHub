"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes

function SyncIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M16.5 5.5A7 7 0 0 0 4 7M3.5 14.5A7 7 0 0 0 16 13"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M16.5 2.5v3h-3M3.5 17.5v-3h3"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ImportCalendarButton({ date }: { date: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const dateRef = useRef(date);
  dateRef.current = date;
  const runningRef = useRef(false);

  const runImport = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`/api/calendar/import?date=${dateRef.current}`, {
        method: "POST",
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      // Re-fetch the current view so any newly imported events appear.
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
      runningRef.current = false;
    }
  }, [router]);

  // Auto-import on load, then quietly in the background every 15 minutes.
  useEffect(() => {
    void runImport();
    const id = setInterval(() => void runImport(), SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [runImport]);

  return (
    <button
      type="button"
      className={`icon-btn import-icon ${busy ? "is-busy" : ""} ${error ? "is-error" : ""}`}
      onClick={() => void runImport()}
      disabled={busy}
      aria-label="Import calendar now"
      title={
        busy
          ? "Importing calendar…"
          : error
            ? "Import failed — click to retry"
            : "Import calendar now (auto-syncs every 15 min)"
      }
    >
      <SyncIcon />
    </button>
  );
}
