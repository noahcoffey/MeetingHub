import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { ingestGeneratedNotes } from "@/lib/ingest";

export const dynamic = "force-dynamic";

// Bearer-token auth for the ingest client. This route is excluded from the session
// middleware (see src/middleware.ts) and gated by INGEST_API_KEY instead.
function isAuthorized(req: Request): boolean {
  const key = process.env.INGEST_API_KEY;
  if (!key) return false; // not configured → reject everything
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Abuse/OOM guard only — sized to never reject legitimate notes. Default 5 MB
// (~800k words; far beyond even a full raw transcript). Tunable via env without a
// code change if a payload ever gets close.
const MAX_BODY_BYTES = (Number(process.env.INGEST_MAX_BODY_KB) || 5120) * 1024;

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Cap the request body: fast-reject on Content-Length, then enforce on actual bytes.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { sourceId, title, startTime, notesGenerated, workspace } =
    (body ?? {}) as {
      sourceId?: unknown;
      title?: unknown;
      startTime?: unknown;
      notesGenerated?: unknown;
      workspace?: unknown;
    };

  if (typeof sourceId !== "string" || sourceId.trim() === "") {
    return NextResponse.json(
      { error: "sourceId is required (the iCal UID, or the source app's own id)" },
      { status: 400 },
    );
  }
  if (typeof notesGenerated !== "string" || notesGenerated.trim() === "") {
    return NextResponse.json(
      { error: "notesGenerated is required" },
      { status: 400 },
    );
  }

  let start: Date | null = null;
  if (typeof startTime === "string" && startTime) {
    const d = new Date(startTime);
    if (!Number.isNaN(d.getTime())) start = d;
  }

  const result = await ingestGeneratedNotes({
    sourceId: sourceId.trim(),
    title: typeof title === "string" ? title : undefined,
    startTime: start,
    notesGenerated,
    workspaceHint: typeof workspace === "string" ? workspace : undefined,
  });

  // 200 = applied to a meeting; 202 = accepted into the review inbox.
  return NextResponse.json(result, { status: result.matched ? 200 : 202 });
}
