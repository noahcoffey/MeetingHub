import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listGoogleAccounts } from "@/lib/google-accounts";
import { googleConfigured } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const accounts = await listGoogleAccounts();
  return NextResponse.json({ configured: googleConfigured(), accounts });
});
