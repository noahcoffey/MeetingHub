import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { editDaySummary, getDaySummaryById } from "@/lib/day-summaries";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Session-authed body edit for the day-view card. Like the v1 twin, this only
// ever writes `markdownEdited` — `markdown: null` resets back to the generated
// original, which regeneration keeps current.
export const PATCH = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  const existing = await getDaySummaryById(id);
  // Scope by the row's own workspace, so a stale tab from another workspace
  // can't write across the boundary.
  if (!existing || existing.workspaceId !== (await getActiveWorkspaceId())) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { markdown } = (body ?? {}) as { markdown?: unknown };
  if (markdown !== null && typeof markdown !== "string") {
    return NextResponse.json(
      { error: "markdown must be a string or null" },
      { status: 400 },
    );
  }

  const item = await editDaySummary(id, markdown);
  return NextResponse.json({
    ok: true,
    edited: !!item?.markdownEdited,
    markdown: item ? (item.markdownEdited ?? item.markdown) : "",
  });
});
