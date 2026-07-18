import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteLink } from "@/lib/project-links";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await deleteLink(id);
  return NextResponse.json({ ok: true });
});
