"use client";

import { useEffect, useRef, useState } from "react";

type GoogleAccount = { id: string; email: string };
type Calendar = { id: string; summary: string; primary: boolean };

// Per-workspace Google calendar selection. Picking an account loads its
// calendars; picking a calendar saves { googleAccountId, googleCalendarId }.
// Clearing the account sends null (falls back to the ICS feed).
export function WorkspaceCalendarPicker({
  accounts,
  accountId,
  calendarId,
  onSave,
}: {
  accounts: GoogleAccount[];
  accountId: string | null;
  calendarId: string | null;
  onSave: (accountId: string | null, calendarId: string | null) => void;
}) {
  const [selAccount, setSelAccount] = useState<string>(accountId ?? "");
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [loading, setLoading] = useState(false);
  // Cache the initially-saved calendar id so the dropdown shows it even before
  // the calendar list loads.
  const savedCalendar = useRef(calendarId);

  useEffect(() => {
    if (!selAccount) {
      setCalendars([]);
      return;
    }
    let alive = true;
    setLoading(true);
    fetch(`/api/calendar/google/accounts/${selAccount}/calendars`)
      .then((r) => (r.ok ? r.json() : { calendars: [] }))
      .then((j) => {
        if (alive) setCalendars(j.calendars ?? []);
      })
      .catch(() => {
        if (alive) setCalendars([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selAccount]);

  if (accounts.length === 0) return null;

  return (
    <div className="ws-cal-picker">
      <span className="ws-cal-label">Google calendar</span>
      <select
        aria-label="Google account"
        value={selAccount}
        onChange={(e) => {
          const v = e.target.value;
          setSelAccount(v);
          savedCalendar.current = null;
          if (v === "") onSave(null, null); // clear → back to ICS/manual
        }}
      >
        <option value="">None (use .ics / manual)</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.email}
          </option>
        ))}
      </select>
      {selAccount && (
        <select
          aria-label="Calendar"
          disabled={loading}
          value={savedCalendar.current ?? ""}
          onChange={(e) => {
            savedCalendar.current = e.target.value;
            if (e.target.value) onSave(selAccount, e.target.value);
          }}
        >
          <option value="">
            {loading ? "Loading…" : "Select a calendar…"}
          </option>
          {calendars.map((c) => (
            <option key={c.id} value={c.id}>
              {c.summary}
              {c.primary ? " (primary)" : ""}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
