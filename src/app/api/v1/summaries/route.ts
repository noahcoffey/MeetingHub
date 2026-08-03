import { NextResponse } from "next/server";
import { listWeeklySummaries, upsertWeeklySummary } from "@/lib/summaries";
import { isValidDateParam, startOfWeek } from "@/lib/dates";
import { err, readJsonBody, resolveWorkspace, withV1 } from "../_lib/helpers";

export const dynamic = "force-dynamic";

// List is meta-only (no markdown bodies) — fetch a summary by id for the body.
export const GET = withV1({}, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;
  const items = await listWeeklySummaries(ws.workspace.id);
  return NextResponse.json({ items });
});

// Upsert by (workspace, weekStart): the runner can safely re-run — 201 on
// first push for a week, 200 on overwrite.
export const PUT = withV1({ write: true }, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const { weekStart, markdown, model, generatedAt } = (parsed.body ?? {}) as {
    weekStart?: unknown;
    markdown?: unknown;
    model?: unknown;
    generatedAt?: unknown;
  };

  if (
    typeof weekStart !== "string" ||
    !isValidDateParam(weekStart) ||
    startOfWeek(weekStart) !== weekStart
  ) {
    return err("weekStart must be a Monday (YYYY-MM-DD)", 400);
  }
  if (typeof markdown !== "string" || markdown.trim() === "") {
    return err("markdown is required", 400);
  }
  if (model !== undefined && model !== null && typeof model !== "string") {
    return err("model must be a string", 400);
  }
  let generatedAtDate: Date | undefined;
  if (generatedAt !== undefined) {
    if (typeof generatedAt !== "string" || Number.isNaN(Date.parse(generatedAt))) {
      return err("generatedAt must be an ISO datetime", 400);
    }
    generatedAtDate = new Date(generatedAt);
  }

  const { item, created } = await upsertWeeklySummary(ws.workspace.id, {
    weekStart,
    markdown,
    model: typeof model === "string" ? model : null,
    generatedAt: generatedAtDate,
  });
  return NextResponse.json({ item }, { status: created ? 201 : 200 });
});
