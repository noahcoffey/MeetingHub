import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createLink } from "@/lib/project-links";

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

  const link = await createLink({
    projectId,
    url: url.trim(),
    label: typeof label === "string" ? label : null,
    // Folder placement comes from the unified browser's own listing; a stale
    // id self-heals back to the base level on the next base listing.
    driveFolderId: typeof driveFolderId === "string" ? driveFolderId : null,
  });
  return NextResponse.json({ link }, { status: 201 });
});
