import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { exchangeCode, fetchUserEmail } from "@/lib/google-calendar";
import { upsertGoogleAccount } from "@/lib/google-accounts";
import { getSingleUser } from "@/lib/webauthn";
import { requestOrigin } from "@/lib/request-origin";
import { OAUTH_STATE_COOKIE } from "../connect/route";

export const dynamic = "force-dynamic";

function back(origin: string, params: Record<string, string>) {
  const url = new URL("/settings/calendars", origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = NextResponse.redirect(url);
  // One-shot state cookie is consumed regardless of outcome.
  res.cookies.set(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

// Google redirects here after consent. Verifies the CSRF state, exchanges the
// code for a refresh token, records the account, and returns to Settings.
export const GET = auth(async (req) => {
  const url = new URL(req.url);
  const origin = requestOrigin(req);
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", origin));
  }

  const err = url.searchParams.get("error");
  if (err) return back(origin, { error: "denied" });

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return back(origin, { error: "state" });
  }

  try {
    const { refreshToken, accessToken, scope } = await exchangeCode(code, origin);
    const email = await fetchUserEmail(accessToken);
    const user = await getSingleUser();
    if (!user) return back(origin, { error: "no_user" });
    await upsertGoogleAccount({
      userId: user.id,
      email,
      refreshToken,
      scope,
    });
    return back(origin, { connected: email });
  } catch {
    // Never surface token/exchange details.
    return back(origin, { error: "exchange" });
  }
});
