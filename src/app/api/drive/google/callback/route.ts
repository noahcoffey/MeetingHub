import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { exchangeCode, fetchUserEmail } from "@/lib/google-auth";
import { upsertGoogleAccount } from "@/lib/google-accounts";
import { setStringSetting } from "@/lib/app-settings";
import {
  DRIVE_ACCOUNT_KEY,
  driveRedirectUri,
  ensureRootFolder,
} from "@/lib/drive";
import { getSingleUser } from "@/lib/webauthn";
import { DRIVE_OAUTH_STATE_COOKIE } from "../connect/route";

export const dynamic = "force-dynamic";

function back(origin: string, params: Record<string, string>) {
  const url = new URL("/settings/drive", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  // One-shot state cookie is consumed regardless of outcome.
  res.cookies.set(DRIVE_OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

// Google redirects here after consent. Verifies the CSRF state, exchanges the
// code, records the account as THE Drive account, eagerly creates the root
// MeetingHub folder, and returns to Settings -> Drive.
export const GET = auth(async (req) => {
  const url = new URL(req.url);
  const origin = url.origin;
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const err = url.searchParams.get("error");
  if (err) return back(origin, { error: "denied" });

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get(DRIVE_OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return back(origin, { error: "state" });
  }

  try {
    const { refreshToken, accessToken, scope } = await exchangeCode(
      code,
      driveRedirectUri(origin),
    );
    const email = await fetchUserEmail(accessToken);
    const user = await getSingleUser();
    if (!user) return back(origin, { error: "no_user" });
    const account = await upsertGoogleAccount({
      userId: user.id,
      email,
      refreshToken,
      scope,
    });
    await setStringSetting(DRIVE_ACCOUNT_KEY, account.id);
    // The exchange's access token is still fresh — use it to create/adopt the
    // root folder now so the connect flow fails loudly if Drive is unusable.
    await ensureRootFolder(accessToken);
    return back(origin, { connected: email });
  } catch {
    // Never surface token/exchange details.
    return back(origin, { error: "exchange" });
  }
});
