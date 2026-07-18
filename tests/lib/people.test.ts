import { beforeEach, describe, expect, it } from "vitest";
import {
  addLinkedTitle,
  createPerson,
  matchPeopleForMeeting,
} from "@/lib/people";
import { makeWorkspace, resetDb } from "../helpers";
import type { Attendee } from "@/db/schema";

let ws: string;

beforeEach(async () => {
  await resetDb();
  ws = await makeWorkspace("Alpha", { isDefault: true });
});

function meeting(title: string, attendees: Attendee[] = []) {
  return { workspaceId: ws, title, attendees };
}

describe("createPerson", () => {
  it("lowercases and trims the email", async () => {
    const p = await createPerson(ws, { name: "Sara", email: "  Sara@X.COM " });
    expect(p.email).toBe("sara@x.com");
  });
  it("allows a null email", async () => {
    const p = await createPerson(ws, { name: "Forum" });
    expect(p.email).toBeNull();
  });
});

describe("matchPeopleForMeeting", () => {
  it("matches by attendee email, case-insensitively", async () => {
    const p = await createPerson(ws, { name: "Sara", email: "sara@x.com" });
    const matched = await matchPeopleForMeeting(
      meeting("Some meeting", [{ email: "SARA@X.com" }]),
    );
    expect(matched.map((m) => m.id)).toEqual([p.id]);
  });

  it("matches by an exact linked title", async () => {
    const p = await createPerson(ws, { name: "Sara" });
    await addLinkedTitle(p.id, "Weekly Sync");
    const matched = await matchPeopleForMeeting(meeting("Weekly Sync"));
    expect(matched.map((m) => m.id)).toEqual([p.id]);
  });

  it("does not match on a different title or email", async () => {
    await createPerson(ws, { name: "Sara", email: "sara@x.com" });
    const matched = await matchPeopleForMeeting(
      meeting("Unrelated", [{ email: "someone@else.com" }]),
    );
    expect(matched).toHaveLength(0);
  });

  it("is scoped to the meeting's workspace", async () => {
    const other = await makeWorkspace("Beta");
    await createPerson(other, { name: "Sara", email: "sara@x.com" });
    const matched = await matchPeopleForMeeting(
      meeting("Some meeting", [{ email: "sara@x.com" }]),
    );
    expect(matched).toHaveLength(0);
  });
});
