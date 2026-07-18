import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteNote, saveNoteBody, updateNoteTitle } from "@/lib/notes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { notes, baseNotesUpdatedAt, title } = (body ?? {}) as {
    notes?: unknown;
    baseNotesUpdatedAt?: unknown;
    title?: unknown;
  };

  // Body autosave path (with optimistic-concurrency check). Must come before
  // the title path so autosave never falls through.
  if (typeof notes === "string") {
    const base =
      typeof baseNotesUpdatedAt === "string"
        ? new Date(baseNotesUpdatedAt)
        : null;
    const result = await saveNoteBody(
      id,
      notes,
      base && !Number.isNaN(base.getTime()) ? base : null,
    );
    if (result === null) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!result.ok) {
      return NextResponse.json(
        {
          conflict: true,
          notes: result.notes,
          notesUpdatedAt: result.notesUpdatedAt.toISOString(),
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      notesUpdatedAt: result.notesUpdatedAt.toISOString(),
    });
  }

  // Title path — empty string is allowed (renders as "Untitled").
  if (typeof title === "string") {
    const note = await updateNoteTitle(id, title.trim());
    if (!note) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({ note });
  }

  return NextResponse.json({ error: "nothing to update" }, { status: 400 });
});

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await deleteNote(id);
  return NextResponse.json({ ok: true });
});
