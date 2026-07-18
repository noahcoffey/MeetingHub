import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { generateRecoveryCodes } from "@/lib/webauthn";

export const dynamic = "force-dynamic";

// Regenerate the full set of one-time recovery codes (returned once to display).
export const POST = auth(async (req) => {
  const userId = req.auth?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const codes = await generateRecoveryCodes(userId);
  return NextResponse.json({ codes });
});
