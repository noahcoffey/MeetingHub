import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { setPasswordEnabled } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

// Toggle whether password login is allowed (the "re-enable password" setting).
export const PATCH = auth(async (req) => {
  const userId = req.auth?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { enabled } = (await req.json().catch(() => ({}))) as {
    enabled?: unknown;
  };
  await setPasswordEnabled(userId, !!enabled);
  return NextResponse.json({ ok: true });
});
