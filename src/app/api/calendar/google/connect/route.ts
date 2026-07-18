import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { authUrl, googleConfigured } from "@/lib/google-calendar";

export const dynamic = "force-dynamic";

export const OAUTH_STATE_COOKIE = "g_oauth_state";

// Kick off the Google consent flow. Auth-gated: only the logged-in user can
// connect an account (Google redirects back to the callback in the same session).
export const GET = auth(async (req) => {
  const origin = new URL(req.url).origin;
  if (!req.auth) {
    return NextResponse.redirect(new URL("/login", origin));
  }
  if (!googleConfigured()) {
    return NextResponse.redirect(
      new URL("/settings/calendars?error=not_configured", origin),
    );
  }
  const state = randomBytes(16).toString("base64url");
  const res = NextResponse.redirect(authUrl(origin, state));
  res.cookies.set(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600, // 10 minutes to complete consent
  });
  return res;
});
