import { NextResponse } from "next/server";
import { getNote, saveNoteBody, updateNoteTitle } from "@/lib/notes";
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
  const item = await getNote(id);
  if (!item) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, item.workspaceId);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "notes");
  if (disabled) return disabled;
  return NextResponse.json({ item });
});

export const PATCH = withV1({ write: true }, async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const existing = await getNote(id);
  if (!existing) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, existing.workspaceId);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "notes");
  if (disabled) return disabled;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const { title, body } = (parsed.body ?? {}) as {
    title?: unknown;
    body?: unknown;
  };

  const wantsTitle = typeof title === "string";
  const wantsBody = typeof body === "string";
  if (!wantsTitle && !wantsBody) return err("nothing to update", 400);

  if (wantsTitle) await updateNoteTitle(id, title as string);
  // Null base skips the optimistic-concurrency check — API writes are
  // documented last-write-wins.
  if (wantsBody) await saveNoteBody(id, body as string, null);

  return NextResponse.json({ item: await getNote(id) });
});
