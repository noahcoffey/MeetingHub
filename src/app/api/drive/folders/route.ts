import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertInTree } from "@/lib/drive";
import { createFolder, findChildFolder } from "@/lib/google-drive";
import { driveError, resolveDriveContext } from "../_lib";

export const dynamic = "force-dynamic";

// Create a user folder ({ name, parentId?, projectId? }). Drive itself allows
// duplicate sibling names, so we find-first and 409 instead.
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
  const b = body as { name?: unknown; parentId?: unknown; projectId?: unknown };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 255) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const parentId = typeof b.parentId === "string" ? b.parentId : null;
  const projectId = typeof b.projectId === "string" ? b.projectId : null;

  try {
    const ctx = await resolveDriveContext(projectId);
    const target = parentId || ctx.baseFolderId;
    if (target !== ctx.baseFolderId) {
      await assertInTree(ctx.token, ctx.baseFolderId, target);
    }
    const existing = await findChildFolder(ctx.token, target, name);
    if (existing) {
      return NextResponse.json(
        { error: "a folder with that name already exists" },
        { status: 409 },
      );
    }
    const folder = await createFolder(ctx.token, target, name);
    return NextResponse.json({ folder }, { status: 201 });
  } catch (e) {
    const res = driveError(e);
    if (res) return res;
    throw e;
  }
});
