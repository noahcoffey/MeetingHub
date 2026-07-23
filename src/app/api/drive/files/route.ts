import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertInTree } from "@/lib/drive";
import { listChildren, uploadFile } from "@/lib/google-drive";
import { driveError, resolveDriveContext } from "../_lib";

export const dynamic = "force-dynamic";

const DEFAULT_MAX_UPLOAD_MB = 25;

function maxUploadBytes(): number {
  const mb = Number(process.env.DRIVE_MAX_UPLOAD_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_UPLOAD_MB) * 1024 * 1024;
}

// List a folder within the workspace Files/ area (?projectId= switches to the
// project's tree). No folderId = the tree's base folder.
export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const projectId = url.searchParams.get("projectId");
  const folderId = url.searchParams.get("folderId");
  try {
    const ctx = await resolveDriveContext(projectId);
    const target = folderId || ctx.baseFolderId;
    if (target !== ctx.baseFolderId) {
      await assertInTree(ctx.token, ctx.baseFolderId, target);
    }
    const files = await listChildren(ctx.token, target);
    return NextResponse.json({
      baseFolderId: ctx.baseFolderId,
      folderId: target,
      files,
    });
  } catch (e) {
    const res = driveError(e);
    if (res) return res;
    throw e;
  }
});

// Upload one file (multipart form: file, parentId?, projectId?). The whole
// body is buffered — fine for a single user at the configured cap.
export const POST = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const cap = maxUploadBytes();
  // Cheap reject before buffering; the multipart overhead only adds bytes, so
  // a compliant body can't be under the header value.
  const contentLength = Number(req.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > cap + 16 * 1024) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File) || !file.name) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > cap) {
    return NextResponse.json({ error: "file too large" }, { status: 413 });
  }
  const parentIdRaw = form.get("parentId");
  const projectIdRaw = form.get("projectId");
  const parentId = typeof parentIdRaw === "string" ? parentIdRaw : null;
  const projectId = typeof projectIdRaw === "string" ? projectIdRaw : null;

  try {
    const ctx = await resolveDriveContext(projectId);
    const target = parentId || ctx.baseFolderId;
    if (target !== ctx.baseFolderId) {
      await assertInTree(ctx.token, ctx.baseFolderId, target);
    }
    const data = new Uint8Array(await file.arrayBuffer());
    const created = await uploadFile(
      ctx.token,
      target,
      file.name,
      file.type || "application/octet-stream",
      data,
    );
    return NextResponse.json({ file: created }, { status: 201 });
  } catch (e) {
    const res = driveError(e);
    if (res) return res;
    throw e;
  }
});
