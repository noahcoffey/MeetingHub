import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteAgendaItem, updateAgendaItem } from "@/lib/people";

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
  const { content, discussed } = (body ?? {}) as {
    content?: unknown;
    discussed?: unknown;
  };

  const patch: {
    content?: string;
    discussed?: { meetingId: string | null } | null;
  } = {};
  if (typeof content === "string" && content.trim() !== "") {
    patch.content = content.trim();
  }
  // discussed: { meetingId } marks it discussed now; explicit null reopens.
  if (discussed === null) patch.discussed = null;
  else if (typeof discussed === "object" && discussed !== null) {
    const { meetingId } = discussed as { meetingId?: unknown };
    patch.discussed = {
      meetingId: typeof meetingId === "string" && meetingId !== "" ? meetingId : null,
    };
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const item = await updateAgendaItem(id, patch);
  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ item });
});

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await deleteAgendaItem(id);
  return NextResponse.json({ ok: true });
});
