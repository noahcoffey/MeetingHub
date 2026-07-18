import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { removeDependency } from "@/lib/task-dependencies";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await removeDependency(id);
  return NextResponse.json({ ok: true });
});
