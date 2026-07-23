import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertInTree } from "@/lib/drive";
import { downloadFile, getFileMeta, FOLDER_MIME } from "@/lib/google-drive";
import { driveError, resolveDriveContext } from "../../../_lib";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Proxy-stream a file's content from Drive (?projectId= scopes to a project's
// tree). Drive API calls can't come from the browser (CSP connect-src 'self').
export const GET = auth(async (req, routeCtx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (routeCtx as unknown as Ctx).params;
  const projectId = new URL(req.url).searchParams.get("projectId");

  try {
    const ctx = await resolveDriveContext(projectId);
    await assertInTree(ctx.token, ctx.baseFolderId, id);
    const meta = await getFileMeta(ctx.token, id, "id,name,mimeType");
    if (meta.mimeType === FOLDER_MIME) {
      return NextResponse.json(
        { error: "folders cannot be downloaded" },
        { status: 400 },
      );
    }
    // Docs/Sheets/Slides have no binary content (alt=media 403s) — they're
    // opened in Drive instead.
    if (meta.mimeType?.startsWith("application/vnd.google-apps.")) {
      return NextResponse.json(
        { error: "open Google-native files in Drive" },
        { status: 400 },
      );
    }
    const upstream = await downloadFile(ctx.token, id);
    const filename = encodeURIComponent(meta.name ?? "download");
    return new Response(upstream.body, {
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${filename}`,
        ...(upstream.headers.get("content-length")
          ? { "content-length": upstream.headers.get("content-length")! }
          : {}),
      },
    });
  } catch (e) {
    const res = driveError(e);
    if (res) return res;
    throw e;
  }
});
