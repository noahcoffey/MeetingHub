import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { buildAuthUrl, googleConfigured } from "@/lib/google-auth";
import { DRIVE_SCOPES, driveRedirectUri } from "@/lib/drive";

export const dynamic = "force-dynamic";

// Separate cookie from the calendar flow so the two connects can't clobber
// each other's CSRF state.
export const DRIVE_OAUTH_STATE_COOKIE = "g_drive_oauth_state";

// Kick off the Google consent flow for Drive. Auth-gated: only the logged-in
// user can connect (Google redirects back to the callback in the same session).
export const GET = auth(async (req) => {
  const origin = new URL(req.url).origin;
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", origin));
  }
  if (!googleConfigured()) {
    return NextResponse.redirect(
      new URL("/settings/drive?error=not_configured", origin),
    );
  }
  const state = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(
    buildAuthUrl({
      scope: DRIVE_SCOPES,
      redirectUri: driveRedirectUri(origin),
      state,
    }),
  );
  res.cookies.set(DRIVE_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes to complete consent
  });
  return res;
});
