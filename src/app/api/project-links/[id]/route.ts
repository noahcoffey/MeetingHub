import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertInTree, ensureProjectFolder, getDriveToken } from "@/lib/drive";
import { deleteLink, getLinkById, setLinkFolder } from "@/lib/project-links";
import { resolveProjectScope } from "../../drive/_lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Move a link to another folder ({ driveFolderId: string | null }; null = the
// project's top level). Same placement validation as creation: the target
// must be a folder inside the link's own project tree.
export const PATCH = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { driveFolderId } = (body ?? {}) as { driveFolderId?: unknown };
  if (driveFolderId !== null && typeof driveFolderId !== "string") {
    return NextResponse.json({ error: "invalid driveFolderId" }, { status: 400 });
  }

  const existing = await getLinkById(id);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let folderId =
    typeof driveFolderId === "string" && driveFolderId.trim()
      ? driveFolderId.trim()
      : null;
  if (folderId) {
    try {
      const { project, workspace } = await resolveProjectScope(
        existing.projectId,
      );
      const token = await getDriveToken();
      const base = await ensureProjectFolder(token, project, workspace);
      if (folderId === base) {
        folderId = null; // base level is stored as null
      } else {
        await assertInTree(token, base, folderId);
      }
    } catch {
      return NextResponse.json(
        { error: "invalid driveFolderId" },
        { status: 400 },
      );
    }
  }

  const link = await setLinkFolder(id, folderId);
  return NextResponse.json({ link });
});

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await deleteLink(id);
  return NextResponse.json({ ok: true });
});
