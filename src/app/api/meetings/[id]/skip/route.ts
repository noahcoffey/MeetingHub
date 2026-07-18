import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { skipMeeting, unskipMeeting } from "@/lib/meetings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const POST = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await skipMeeting(id);
  return NextResponse.json({ ok: true });
});

// Un-skip (restore) a meeting.
export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await unskipMeeting(id);
  return NextResponse.json({ ok: true });
});
