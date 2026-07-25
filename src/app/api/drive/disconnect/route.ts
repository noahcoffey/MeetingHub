import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { setStringSetting } from "@/lib/app-settings";
import { DRIVE_ACCOUNT_KEY, DRIVE_ROOT_FOLDER_KEY } from "@/lib/drive";

export const dynamic = "force-dynamic";

// Disconnect Drive: clears only the designation keys. The google_accounts row
// stays (it may also serve calendar import), and nothing in Drive is touched.
export const POST = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await setStringSetting(DRIVE_ACCOUNT_KEY, null);
  await setStringSetting(DRIVE_ROOT_FOLDER_KEY, null);
  return NextResponse.json({ ok: true });
});
