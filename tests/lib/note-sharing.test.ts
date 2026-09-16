import { beforeEach, describe, expect, it } from "vitest";
import {
  createNote,
  getNote,
  getSharedNote,
  saveNoteBody,
  setNoteShared,
  SHARE_SLUG_RE,
} from "@/lib/notes";
import { makeWorkspace, resetDb } from "../helpers";

let workspaceId: string;

beforeEach(async () => {
  await resetDb();
  workspaceId = await makeWorkspace("Alpha", { isDefault: true });
});

async function sharedNote(title: string, body: string) {
  const note = await createNote(workspaceId, { title });
  await saveNoteBody(note.id, body, null);
  const shared = await setNoteShared(note.id, true);
  return { id: note.id, slug: shared!.shareSlug! };
}

describe("note sharing", () => {
  it("mints an unguessable slug and serves the note by it", async () => {
    const { slug } = await sharedNote("Plan", "# Plan\n\nbody");
    expect(slug).toMatch(SHARE_SLUG_RE);
    const view = await getSharedNote(slug);
    expect(view).toMatchObject({ title: "Plan", notes: "# Plan\n\nbody" });
  });

  it("rejects malformed slugs without hitting the database", async () => {
    expect(await getSharedNote("not-a-slug")).toBeUndefined();
    expect(await getSharedNote("")).toBeUndefined();
    // Right shape, wrong value.
    expect(await getSharedNote("a".repeat(22))).toBeUndefined();
  });

  it("leaves other notes unreachable — one slug serves exactly one note", async () => {
    await createNote(workspaceId, { title: "Private" });
    const { slug } = await sharedNote("Shared", "x");
    expect((await getSharedNote(slug))!.title).toBe("Shared");
  });

  it("revoking clears the slug for good — re-sharing mints a different one", async () => {
    const { id, slug } = await sharedNote("Shared", "x");
    await setNoteShared(id, false);
    expect(await getSharedNote(slug)).toBeUndefined();
    expect((await getNote(id))!.shareSlug).toBeNull();

    const again = await setNoteShared(id, true);
    expect(again!.shareSlug).not.toBe(slug);
    expect(await getSharedNote(again!.shareSlug!)).toBeDefined();
    expect(await getSharedNote(slug)).toBeUndefined();
  });

  it("never touches notesUpdatedAt — an open editor must not 409", async () => {
    const note = await createNote(workspaceId, { title: "Plan" });
    const saved = await saveNoteBody(note.id, "body", null);
    const base = (saved as { notesUpdatedAt: Date }).notesUpdatedAt;

    await setNoteShared(note.id, true);
    await setNoteShared(note.id, false);

    const after = await getNote(note.id);
    expect(after!.notesUpdatedAt.getTime()).toBe(base.getTime());
    // A pending autosave keyed to the pre-share timestamp still applies.
    const result = await saveNoteBody(note.id, "body 2", base);
    expect(result).toMatchObject({ ok: true });
  });

  it("returns undefined for a missing note id", async () => {
    expect(
      await setNoteShared("00000000-0000-0000-0000-000000000000", true),
    ).toBeUndefined();
  });
});
