import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { removeLinkedTitle } from "@/lib/people";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; titleId: string }> };

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { titleId } = await (ctx as unknown as Ctx).params;
  await removeLinkedTitle(titleId);
  return NextResponse.json({ ok: true });
});
