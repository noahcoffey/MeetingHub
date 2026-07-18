import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteGoogleAccount, getAccountById } from "@/lib/google-accounts";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Disconnect an account. Workspaces pointing at it fall back to ICS/manual
// (FK set null).
export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  const account = await getAccountById(id);
  if (!account) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  await deleteGoogleAccount(id);
  return NextResponse.json({ ok: true });
});
