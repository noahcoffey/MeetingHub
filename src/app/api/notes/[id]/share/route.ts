import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { setNoteShared } from "@/lib/notes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Session-authed (and inside the middleware matcher, so the cross-origin write
// check applies). POST publishes the note at a fresh /s/<slug>; DELETE revokes,
// which permanently kills the current link.
export const POST = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  const note = await setNoteShared(id, true);
  if (!note) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ shareSlug: note.shareSlug });
});

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  const note = await setNoteShared(id, false);
  if (!note) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ shareSlug: null });
});
