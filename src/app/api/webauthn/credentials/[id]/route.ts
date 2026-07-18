import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  countCredentials,
  deleteCredential,
  renameCredential,
  setPasswordEnabled,
} from "@/lib/webauthn";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = auth(async (req, ctx) => {
  const userId = req.auth?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  const { name } = (await req.json().catch(() => ({}))) as { name?: unknown };
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  await renameCredential(id, userId, name.trim().slice(0, 60));
  return NextResponse.json({ ok: true });
});

export const DELETE = auth(async (req, ctx) => {
  const userId = req.auth?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await deleteCredential(id, userId);
  // No passkeys left → re-enable password so the account isn't locked out.
  if ((await countCredentials(userId)) === 0) {
    await setPasswordEnabled(userId, true);
  }
  return NextResponse.json({ ok: true });
});
