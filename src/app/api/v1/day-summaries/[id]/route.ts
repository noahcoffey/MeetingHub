import { NextResponse } from "next/server";
import { editDaySummary, getDaySummaryById } from "@/lib/day-summaries";
import {
  checkFeature,
  checkRowWorkspace,
  err,
  readJsonBody,
  withV1,
} from "../../_lib/helpers";

export const dynamic = "force-dynamic";

export const GET = withV1({}, async (_req, ctx, principal) => {
  const { id } = await ctx.params;
  const item = await getDaySummaryById(id);
  if (!item) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, item.workspaceId);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "meetings");
  if (disabled) return disabled;
  return NextResponse.json({ item });
});

// Edits land in `markdownEdited`, never over the generated body — so a later
// regeneration can't destroy them and "reset" always has an original to return
// to. `markdown: null` (or text identical to the generated body) clears the
// edit. The generated body itself is not writable here; regenerate via POST.
export const PATCH = withV1({ write: true }, async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const existing = await getDaySummaryById(id);
  if (!existing) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, existing.workspaceId);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "meetings");
  if (disabled) return disabled;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const body = (parsed.body ?? {}) as { markdown?: unknown };
  if (!("markdown" in body)) return err("nothing to update", 400);
  if (body.markdown !== null && typeof body.markdown !== "string") {
    return err("markdown must be a string or null", 400);
  }

  const item = await editDaySummary(id, body.markdown as string | null);
  return NextResponse.json({ item });
});
