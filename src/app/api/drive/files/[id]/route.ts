import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertInTree, collectFolderTreeIds, managedFolderIds } from "@/lib/drive";
import { FOLDER_MIME, getFileMeta, renameFile, trashFile } from "@/lib/google-drive";
import { rehomeLinksFromFolders } from "@/lib/project-links";
import { driveError, resolveDriveContext, type DriveRequestContext } from "../../_lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Both mutations share the guard rails: the target must live under the
// request's base folder and must not be an app-managed folder (the base
// itself, workspace/root folders, any project folder).
async function guardTarget(
  ctx: DriveRequestContext,
  fileId: string,
): Promise<NextResponse | null> {
  const managed = await managedFolderIds(ctx.workspace.id);
  if (fileId === ctx.baseFolderId || managed.has(fileId)) {
    return NextResponse.json(
      { error: "this folder is managed by the app" },
      { status: 403 },
    );
  }
  await assertInTree(ctx.token, ctx.baseFolderId, fileId);
  return null;
}

// Rename ({ name, projectId? }).
export const PATCH = auth(async (req, routeCtx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (routeCtx as unknown as Ctx).params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const b = body as { name?: unknown; projectId?: unknown };
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (!name || name.length > 255) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const projectId = typeof b.projectId === "string" ? b.projectId : null;

  try {
    const ctx = await resolveDriveContext(projectId);
    const blocked = await guardTarget(ctx, id);
    if (blocked) return blocked;
    const file = await renameFile(ctx.token, id, name);
    return NextResponse.json({ file });
  } catch (e) {
    const res = driveError(e);
    if (res) return res;
    throw e;
  }
});

// Move to Drive trash (recoverable there for ~30 days).
export const DELETE = auth(async (req, routeCtx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (routeCtx as unknown as Ctx).params;
  const projectId = new URL(req.url).searchParams.get("projectId");

  try {
    const ctx = await resolveDriveContext(projectId);
    const blocked = await guardTarget(ctx, id);
    if (blocked) return blocked;
    // Trashing a folder subtree in a project orphans any links placed in it —
    // collect the tree BEFORE trashing (children queries need it live), then
    // re-home those links to the project's base level.
    let treeIds: string[] = [];
    if (projectId) {
      const meta = await getFileMeta(ctx.token, id, "id,mimeType");
      if (meta.mimeType === FOLDER_MIME) {
        treeIds = await collectFolderTreeIds(ctx.token, id);
      }
    }
    await trashFile(ctx.token, id);
    await rehomeLinksFromFolders(treeIds);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const res = driveError(e);
    if (res) return res;
    throw e;
  }
});
