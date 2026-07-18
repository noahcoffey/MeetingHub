import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const isProd = process.env.NODE_ENV === "production";

// Strict CSP. script-src uses a per-request nonce + strict-dynamic (Next applies the
// nonce to its own scripts when it sees this header on the request). style-src keeps
// 'unsafe-inline' because we rely on inline style attributes (chart dots, sliders)
// and Next injects inline styles — style-based injection is far lower risk.
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export default auth((req) => {
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth?.user;

  // CSRF defense-in-depth: reject cross-origin writes to the API. /api/auth and
  // the bearer-only /api/ingest and /api/v1 are excluded from the matcher, so
  // they don't reach here.
  if (nextUrl.pathname.startsWith("/api/") && MUTATING.has(req.method)) {
    const origin = req.headers.get("origin");
    if (origin) {
      let ok = false;
      try {
        ok = new URL(origin).host === req.headers.get("host");
      } catch {
        ok = false;
      }
      if (!ok) return NextResponse.json({ error: "bad origin" }, { status: 403 });
    }
  }

  // Auth gating (was the authorized() callback).
  const isOnLogin = nextUrl.pathname.startsWith("/login");
  if (isOnLogin) {
    if (isLoggedIn) return NextResponse.redirect(new URL("/", nextUrl));
  } else if (!isLoggedIn) {
    const login = new URL("/login", nextUrl);
    login.searchParams.set("callbackUrl", nextUrl.pathname + nextUrl.search);
    return NextResponse.redirect(login);
  }

  // CSP (production only — the dev server needs eval/ws for HMR + fast refresh).
  if (!isProd) return NextResponse.next();

  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  return res;
});

// Protect everything except NextAuth's own routes, the public health check,
// the bearer-only ingest + v1 API endpoints, the public API docs
// (openapi.yaml + api-docs.html — no secrets, and served CSP-free so the
// self-contained page's inline scripts run), and Next static assets.
export const config = {
  matcher: [
    "/((?!api/auth|api/health|api/ingest|api/v1|api/webauthn/authenticate|openapi.yaml|api-docs.html|_next/static|_next/image|favicon.ico|icon|apple-icon).*)",
  ],
};
