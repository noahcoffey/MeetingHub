import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

// Same-origin favicon proxy for saved links: the production CSP is
// `img-src 'self'`, so the browser can't load site favicons directly.
// Resolution is delegated to Google's s2 service (handles <link rel=icon>,
// redirects, etc.) — the fetched host is fixed, only the domain is a
// parameter, so there's no SSRF surface.
const S2_URL = "https://www.google.com/s2/favicons";
const FETCH_TIMEOUT_MS = 10_000;

// RFC-ish hostname: dot-separated labels, no scheme/path/port shenanigans.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)+$/i;

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const domain = new URL(req.url).searchParams.get("domain") ?? "";
  if (domain.length > 253 || !DOMAIN_RE.test(domain)) {
    return NextResponse.json({ error: "invalid domain" }, { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const upstream = await fetch(
      `${S2_URL}?domain=${encodeURIComponent(domain)}&sz=32`,
      { signal: controller.signal },
    );
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: "no favicon" }, { status: 404 });
    }
    return new Response(upstream.body, {
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "image/png",
        // Favicons change rarely; let the browser hold them for a week.
        "cache-control": "private, max-age=604800",
      },
    });
  } catch {
    return NextResponse.json({ error: "no favicon" }, { status: 404 });
  } finally {
    clearTimeout(timer);
  }
});
