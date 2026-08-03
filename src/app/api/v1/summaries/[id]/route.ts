import { NextResponse } from "next/server";
import { getWeeklySummary } from "@/lib/summaries";
import { checkRowWorkspace, err, withV1 } from "../../_lib/helpers";

export const dynamic = "force-dynamic";

// Full row, including the markdown body.
export const GET = withV1({}, async (_req, ctx, principal) => {
  const { id } = await ctx.params;
  const item = await getWeeklySummary(id);
  if (!item) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, item.workspaceId);
  if (!ws.ok) return ws.res;
  return NextResponse.json({ item });
});
