import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { meetings } from "@/db/schema";
import { updateMeetingMeta, upsertCalendarMeetings } from "@/lib/meetings";
import { makeWorkspace, resetDb } from "../helpers";

let ws: string;

beforeEach(async () => {
  await resetDb();
  ws = await makeWorkspace("Alpha", { isDefault: true });
});

const event = (title: string) => ({
  calendarEventId: "uid-1",
  title,
  description: null,
  startTime: new Date("2026-08-21T15:00:00Z"),
  endTime: null,
  attendees: [] as [],
});

async function importMeeting(title = "Weekly Sync") {
  await upsertCalendarMeetings(ws, [event(title)]);
  const [m] = await db
    .select()
    .from(meetings)
    .where(eq(meetings.calendarEventId, "uid-1"));
  return m;
}

describe("meeting rename vs calendar re-import", () => {
  it("re-import updates the title while it is untouched", async () => {
    await importMeeting("Weekly Sync");
    await upsertCalendarMeetings(ws, [event("Weekly Sync (moved)")]);
    const [after] = await db
      .select()
      .from(meetings)
      .where(eq(meetings.calendarEventId, "uid-1"));
    expect(after.title).toBe("Weekly Sync (moved)");
    expect(after.titleEditedAt).toBeNull();
  });

  it("a renamed title is pinned and survives re-import", async () => {
    const m = await importMeeting();
    await updateMeetingMeta(m.id, { title: "Roadmap review" });
    await upsertCalendarMeetings(ws, [event("Weekly Sync")]);
    const [after] = await db.select().from(meetings).where(eq(meetings.id, m.id));
    expect(after.title).toBe("Roadmap review");
    expect(after.titleEditedAt).not.toBeNull();
  });

  it("re-import still updates everything else on a renamed meeting", async () => {
    const m = await importMeeting();
    await updateMeetingMeta(m.id, { title: "Roadmap review" });
    await upsertCalendarMeetings(ws, [
      { ...event("Weekly Sync"), description: "new agenda" },
    ]);
    const [after] = await db.select().from(meetings).where(eq(meetings.id, m.id));
    expect(after.title).toBe("Roadmap review");
    expect(after.description).toBe("new agenda");
  });

  it("round-tripping an unchanged title does NOT pin it", async () => {
    const m = await importMeeting("Weekly Sync");
    // e.g. an MCP client PATCHing back all fields it just read.
    await updateMeetingMeta(m.id, { title: "Weekly Sync" });
    const [mid] = await db.select().from(meetings).where(eq(meetings.id, m.id));
    expect(mid.titleEditedAt).toBeNull();

    await upsertCalendarMeetings(ws, [event("Weekly Sync (moved)")]);
    const [after] = await db.select().from(meetings).where(eq(meetings.id, m.id));
    expect(after.title).toBe("Weekly Sync (moved)");
  });

  it("renaming a manual meeting just renames it", async () => {
    const [m] = await db
      .insert(meetings)
      .values({
        workspaceId: ws,
        title: "Quick chat",
        startTime: new Date("2026-08-21T16:00:00Z"),
        source: "manual",
      })
      .returning();
    const updated = await updateMeetingMeta(m.id, { title: "1:1 with Sam" });
    expect(updated?.title).toBe("1:1 with Sam");
  });
});
