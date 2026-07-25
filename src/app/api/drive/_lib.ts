import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { projects, workspaces, type Workspace } from "@/db/schema";
import {
  DriveNotConnectedError,
  DriveScopeError,
  ensureProjectFolder,
  ensureWorkspaceFolders,
  getDriveToken,
} from "@/lib/drive";
import { GoogleAuthError, GoogleNotConfiguredError } from "@/lib/google-auth";
import { DriveApiError } from "@/lib/google-drive";
import { isFeatureEnabled } from "@/lib/workspaces";
import { getActiveWorkspace } from "@/lib/workspace-context";

// Shared plumbing for the /api/drive/* file routes: resolve which tree the
// request operates on (workspace Files/ area or a project's folder) and map
// the lib error types onto the browser's state contract.

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export type DriveRequestContext = {
  token: string;
  workspace: Workspace;
  baseFolderId: string;
};

// projectId set -> the project's folder, scoped by the project's OWN workspace
// (deep-link safe, matching the detail-page convention). Otherwise the active
// workspace's Files/ folder. Lazily creates whatever is missing.
export async function resolveDriveContext(
  projectId: string | null,
): Promise<DriveRequestContext> {
  const token = await getDriveToken();
  if (projectId) {
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId));
    if (!project) throw new HttpError(404, "project not found");
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, project.workspaceId));
    if (!workspace) throw new HttpError(404, "project not found");
    if (!isFeatureEnabled(workspace, "files")) {
      throw new HttpError(403, "files_disabled");
    }
    const baseFolderId = await ensureProjectFolder(token, project, workspace);
    return { token, workspace, baseFolderId };
  }
  const workspace = await getActiveWorkspace();
  if (!isFeatureEnabled(workspace, "files")) {
    throw new HttpError(403, "files_disabled");
  }
  const folders = await ensureWorkspaceFolders(token, workspace);
  return { token, workspace, baseFolderId: folders.filesFolderId };
}

// Map known error types to responses; null means "not ours — rethrow".
export function driveError(e: unknown): NextResponse | null {
  if (e instanceof HttpError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof GoogleNotConfiguredError) {
    return NextResponse.json({ error: "not_configured" }, { status: 400 });
  }
  if (e instanceof DriveNotConnectedError) {
    return NextResponse.json({ error: "not_connected" }, { status: 400 });
  }
  if (e instanceof GoogleAuthError) {
    return NextResponse.json({ error: "reconnect_required" }, { status: 400 });
  }
  if (e instanceof DriveScopeError) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (e instanceof DriveApiError) {
    if (e.status === 404) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (e.status === 403 || e.status === 429) {
      return NextResponse.json({ error: "drive_busy" }, { status: 503 });
    }
    return NextResponse.json({ error: "drive_error" }, { status: 502 });
  }
  return null;
}
