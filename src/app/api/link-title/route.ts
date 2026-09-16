import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { safeFetchText } from "@/lib/net-guard";
import { extractTitle, isUselessTitle } from "@/lib/link-title";

export const dynamic = "force-dynamic";

// Resolves a pasted URL to its page title so the editor can render it as
// `[Title](url)` instead of a naked link. Best-effort by design: every failure
// path is a 200 with `title: null`, and the client just leaves the URL alone.
//
// The URL is user-supplied and fetched server-side, so it goes through the same
// SSRF guard as the ICS feed (scheme + resolved-IP checks on every redirect
// hop). `truncate` because the title is in the <head> — no need for the body.
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 6_000;
const MAX_URL_LENGTH = 2048;

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url).searchParams.get("url") ?? "";
  if (!url || url.length > MAX_URL_LENGTH) {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  let title: string | null = null;
  try {
    const html = await safeFetchText(url, {
      maxBytes: MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
      truncate: true,
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "accept-language": "en-US,en;q=0.9",
        // Plenty of sites serve a stub (or a 403) to an unknown agent.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    const found = extractTitle(html);
    if (found && !isUselessTitle(found, url)) title = found;
  } catch {
    // Blocked, unreachable, timed out, not HTML — all the same to the caller.
    title = null;
  }

  return NextResponse.json(
    { title },
    // Pasting the same URL twice in a session shouldn't refetch it.
    { headers: { "cache-control": "private, max-age=600" } },
  );
});
