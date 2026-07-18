import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addHiddenTitle, listHiddenTitles } from "@/lib/meetings";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const workspaceId = await getActiveWorkspaceId();
  return NextResponse.json({ titles: await listHiddenTitles(workspaceId) });
});

export const POST = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { title } = (body ?? {}) as { title?: unknown };
  if (typeof title !== "string" || title.trim() === "") {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }
  const workspaceId = await getActiveWorkspaceId();
  await addHiddenTitle(workspaceId, title.trim());
  return NextResponse.json({ ok: true }, { status: 201 });
});
