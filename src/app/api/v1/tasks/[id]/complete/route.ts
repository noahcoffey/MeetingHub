import { NextResponse } from "next/server";
import { getActionItem, updateActionItem } from "@/lib/action-items";
import { checkRowWorkspace, err, withV1 } from "../../../_lib/helpers";

export const dynamic = "force-dynamic";

// Convenience for the common automation: mark done. Completing a recurring
// task spawns the next occurrence, returned as `next`.
export const POST = withV1({ write: true }, async (_req, ctx, principal) => {
  const { id } = await ctx.params;
  const existing = await getActionItem(id);
  if (!existing) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, existing.workspaceId);
  if (!ws.ok) return ws.res;

  const { item, next } = await updateActionItem(id, { status: "done" });
  if (!item) return err("not found", 404);
  return NextResponse.json({ item, next: next ?? null });
});
