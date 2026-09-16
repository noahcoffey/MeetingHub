// Pure HTML -> page-title extraction for the "paste a URL, get a titled link"
// editor affordance. No I/O and no DOM: the route hands it the first chunk of a
// fetched document (see /api/link-title) and gets back a display string.
//
// Deliberately regex-based rather than a parser dependency: we only ever want
// <title> / og:title out of a <head>, and the input is untrusted HTML we never
// render — it becomes the *text* of a markdown link, nothing more.

const MAX_TITLE_LENGTH = 200;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function clean(raw: string): string | null {
  // Entities first, then collapse all whitespace (titles are routinely wrapped
  // across lines in the source), then trim and cap.
  const text = decodeEntities(raw).replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > MAX_TITLE_LENGTH
    ? `${text.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`
    : text;
}

// Pulls the content= value out of a <meta> tag, whichever order the attributes
// come in and whichever quote style is used.
function metaContent(tag: string): string | null {
  const m = tag.match(/\scontent\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

// og:title (and twitter:title) win over <title>: they're the human headline,
// while <title> usually carries a " | Site Name" suffix.
export function extractTitle(html: string): string | null {
  for (const wanted of ["og:title", "twitter:title"]) {
    for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
      const name = tag.match(
        /\s(?:property|name)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/i,
      );
      const key = (name?.[2] ?? name?.[3] ?? name?.[4] ?? "").toLowerCase();
      if (key !== wanted) continue;
      const content = metaContent(tag);
      const title = content ? clean(content) : null;
      if (title) return title;
    }
  }
  const t = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return t ? clean(t[1]) : null;
}

// A title that's just the URL (or its host) is no better than the bare link —
// the editor should leave the pasted text alone in that case.
export function isUselessTitle(title: string, url: string): boolean {
  const t = title.trim().toLowerCase().replace(/\/+$/, "");
  const raw = url.trim().toLowerCase().replace(/\/+$/, "");
  if (t === raw) return true;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return t === host || t === host.replace(/^www\./, "");
  } catch {
    return false;
  }
}
