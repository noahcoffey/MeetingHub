import { NextResponse } from "next/server";
import { listDaySummaries, upsertDaySummary } from "@/lib/day-summaries";
import { isValidDateParam } from "@/lib/dates";
import {
  checkFeature,
  err,
  readJsonBody,
  resolveWorkspace,
  withV1,
} from "../_lib/helpers";

export const dynamic = "force-dynamic";

// List is meta-only (no markdown bodies) — fetch a summary by id for the body.
// Optional ?from=&to= (YYYY-MM-DD, inclusive) narrow the range; no pagination.
export const GET = withV1({}, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "meetings");
  if (disabled) return disabled;

  const params = new URL(req.url).searchParams;
  const from = params.get("from");
  const to = params.get("to");
  if (from !== null && !isValidDateParam(from)) {
    return err("from must be YYYY-MM-DD", 400);
  }
  if (to !== null && !isValidDateParam(to)) {
    return err("to must be YYYY-MM-DD", 400);
  }

  const items = await listDaySummaries(ws.workspace.id, {
    from: from ?? undefined,
    to: to ?? undefined,
  });
  return NextResponse.json({ items });
});

// Upsert by (workspace, day), so the runner can re-run safely — 201 on the
// first push for a day, 200 on overwrite. Any day is allowed; backfilling a
// past day is a normal thing to want.
//
// `inputFingerprint` should be the value the runner got from
// /api/v1/day-summary-context before generating. It is stored as given, not
// recomputed — see upsertDaySummary for why that matters.
export const PUT = withV1({ write: true }, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "meetings");
  if (disabled) return disabled;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const { date, markdown, model, generatedAt, inputFingerprint } =
    (parsed.body ?? {}) as {
      date?: unknown;
      markdown?: unknown;
      model?: unknown;
      generatedAt?: unknown;
      inputFingerprint?: unknown;
    };

  if (typeof date !== "string" || !isValidDateParam(date)) {
    return err("date is required (YYYY-MM-DD)", 400);
  }
  if (typeof markdown !== "string" || markdown.trim() === "") {
    return err("markdown is required", 400);
  }
  if (model !== undefined && model !== null && typeof model !== "string") {
    return err("model must be a string", 400);
  }
  if (inputFingerprint !== undefined && typeof inputFingerprint !== "string") {
    return err("inputFingerprint must be a string", 400);
  }
  let generatedAtDate: Date | undefined;
  if (generatedAt !== undefined) {
    if (typeof generatedAt !== "string" || Number.isNaN(Date.parse(generatedAt))) {
      return err("generatedAt must be an ISO datetime", 400);
    }
    generatedAtDate = new Date(generatedAt);
  }

  const { item, created } = await upsertDaySummary(ws.workspace.id, {
    day: date,
    markdown,
    model: typeof model === "string" ? model : null,
    generatedAt: generatedAtDate,
    inputFingerprint:
      typeof inputFingerprint === "string" ? inputFingerprint : undefined,
  });
  return NextResponse.json({ item }, { status: created ? 201 : 200 });
});
