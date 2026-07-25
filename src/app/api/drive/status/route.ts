import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getDriveStatus } from "@/lib/drive";

export const dynamic = "force-dynamic";

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const status = await getDriveStatus();
  return NextResponse.json(status);
});
