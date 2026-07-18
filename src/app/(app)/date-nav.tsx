"use client";

import { useRouter } from "next/navigation";
import { shiftDate, shiftMonth, todayInAppTz } from "@/lib/dates";

export function DateNav({
  date,
  basePath = "/",
  query,
  unit = "day",
}: {
  date: string;
  basePath?: string;
  // Extra query params to preserve across date changes (e.g. { view: "notes" }).
  query?: Record<string, string>;
  // "month": arrows step whole months and the picker selects a month (the
  // date param stays a full YYYY-MM-DD, pinned to the 1st).
  unit?: "day" | "month";
}) {
  const router = useRouter();
  const isMonth = unit === "month";

  function go(next: string) {
    const sp = new URLSearchParams(query);
    if (next !== todayInAppTz()) sp.set("date", next);
    const qs = sp.toString();
    router.push(qs ? `${basePath}?${qs}` : basePath);
  }

  return (
    <div className="date-nav">
      <button
        type="button"
        aria-label={isMonth ? "Previous month" : "Previous day"}
        onClick={() => go(isMonth ? shiftMonth(date, -1) : shiftDate(date, -1))}
      >
        ‹
      </button>
      {isMonth ? (
        <input
          type="month"
          value={date.slice(0, 7)}
          onChange={(e) => {
            if (e.target.value) go(`${e.target.value}-01`);
          }}
        />
      ) : (
        <input
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) go(e.target.value);
          }}
        />
      )}
      <button
        type="button"
        aria-label={isMonth ? "Next month" : "Next day"}
        onClick={() => go(isMonth ? shiftMonth(date, 1) : shiftDate(date, 1))}
      >
        ›
      </button>
      <button type="button" className="today-btn" onClick={() => go(todayInAppTz())}>
        {isMonth ? "This month" : "Today"}
      </button>
    </div>
  );
}
