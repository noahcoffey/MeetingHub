import { describe, expect, it } from "vitest";
import { mapGoogleEvents, type GoogleEvent } from "@/lib/google-calendar";
import { calendarSourceKind } from "@/lib/calendar-import";
import type { Workspace } from "@/db/schema";

describe("mapGoogleEvents", () => {
  it("maps a timed event with attendees", () => {
    const events: GoogleEvent[] = [
      {
        id: "evt1",
        summary: "1:1",
        description: "sync",
        start: { dateTime: "2026-07-10T15:00:00Z" },
        end: { dateTime: "2026-07-10T15:30:00Z" },
        attendees: [
          { email: "a@x.com", displayName: "A", responseStatus: "accepted" },
          { displayName: "No email" },
          {},
        ],
      },
    ];
    const [m] = mapGoogleEvents(events);
    expect(m.calendarEventId).toBe("evt1");
    expect(m.title).toBe("1:1");
    expect(m.startTime.toISOString()).toBe("2026-07-10T15:00:00.000Z");
    expect(m.endTime?.toISOString()).toBe("2026-07-10T15:30:00.000Z");
    // The attendee with neither email nor name is dropped.
    expect(m.attendees).toHaveLength(2);
    expect(m.attendees[0]).toEqual({
      email: "a@x.com",
      name: "A",
      responseStatus: "accepted",
    });
  });

  it("treats an all-day event as UTC midnight", () => {
    const [m] = mapGoogleEvents([
      { id: "allday", summary: "Holiday", start: { date: "2026-07-04" } },
    ]);
    expect(m.startTime.toISOString()).toBe("2026-07-04T00:00:00.000Z");
    expect(m.endTime).toBeNull();
  });

  it("skips cancelled events and rows without id/start", () => {
    const out = mapGoogleEvents([
      { id: "c", status: "cancelled", start: { dateTime: "2026-07-10T00:00:00Z" } },
      { summary: "no id", start: { dateTime: "2026-07-10T00:00:00Z" } },
      { id: "no-start", summary: "x" },
    ]);
    expect(out).toHaveLength(0);
  });

  it("falls back to a placeholder title", () => {
    const [m] = mapGoogleEvents([
      { id: "x", start: { dateTime: "2026-07-10T00:00:00Z" } },
    ]);
    expect(m.title).toBe("(no title)");
  });

  it("dedupes by event id (last wins)", () => {
    const out = mapGoogleEvents([
      { id: "dup", summary: "first", start: { dateTime: "2026-07-10T00:00:00Z" } },
      { id: "dup", summary: "second", start: { dateTime: "2026-07-10T01:00:00Z" } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("second");
  });
});

describe("calendarSourceKind", () => {
  const base = { icsUrl: null, googleAccountId: null, googleCalendarId: null };
  it("prefers Google when an account + calendar are set", () => {
    expect(
      calendarSourceKind({
        ...base,
        icsUrl: "https://x/y.ics",
        googleAccountId: "acc",
        googleCalendarId: "cal",
      } as Workspace),
    ).toBe("google");
  });
  it("falls back to ics", () => {
    expect(
      calendarSourceKind({ ...base, icsUrl: "https://x/y.ics" } as Workspace),
    ).toBe("ics");
  });
  it("is none when nothing is configured", () => {
    expect(calendarSourceKind(base as Workspace)).toBe("none");
  });
  it("is not google with an account but no calendar", () => {
    expect(
      calendarSourceKind({ ...base, googleAccountId: "acc" } as Workspace),
    ).toBe("none");
  });
});
