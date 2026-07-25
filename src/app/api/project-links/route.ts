import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { assertInTree, ensureProjectFolder, getDriveToken } from "@/lib/drive";
import { createLink } from "@/lib/project-links";
import { resolveProjectScope } from "../drive/_lib";

export const dynamic = "force-dynamic";

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

  const { projectId, url, label, driveFolderId } = (body ?? {}) as {
    projectId?: unknown;
    url?: unknown;
    label?: unknown;
    driveFolderId?: unknown;
  };

  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  if (typeof url !== "string" || !url.trim()) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  try {
    new URL(url.trim());
  } catch {
    return NextResponse.json({ error: "url must be a valid, absolute URL" }, { status: 400 });
  }
  if (driveFolderId !== undefined && driveFolderId !== null && typeof driveFolderId !== "string") {
    return NextResponse.json({ error: "invalid driveFolderId" }, { status: 400 });
  }

  // Normalize ("" -> null) and verify a real placement actually sits inside
  // this project's Drive tree — the self-heal only rescues links whose folder
  // DIES, so an out-of-tree id would otherwise be invisible forever.
  let folderId =
    typeof driveFolderId === "string" && driveFolderId.trim()
      ? driveFolderId.trim()
      : null;
  if (folderId) {
    try {
      const { project, workspace } = await resolveProjectScope(projectId);
      const token = await getDriveToken();
      const base = await ensureProjectFolder(token, project, workspace);
      if (folderId === base) {
        folderId = null; // base level is stored as null
      } else {
        await assertInTree(token, base, folderId);
      }
    } catch {
      // Covers Drive unavailable, unknown project, and out-of-tree ids alike.
      return NextResponse.json(
        { error: "invalid driveFolderId" },
        { status: 400 },
      );
    }
  }

  const link = await createLink({
    projectId,
    url: url.trim(),
    label: typeof label === "string" ? label : null,
    driveFolderId: folderId,
  });
  return NextResponse.json({ link }, { status: 201 });
});
