import "server-only";
import { eq, and, isNotNull } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  workspaces,
  type Project,
  type Workspace,
} from "@/db/schema";
import { getStringSetting, setStringSetting } from "./app-settings";
import { getAccountById, getRefreshToken } from "./google-accounts";
import type { SafeGoogleAccount } from "./google-accounts";
import {
  accessTokenFromRefresh,
  googleConfigured,
  GoogleNotConfiguredError,
} from "./google-auth";
import {
  createFolder,
  DriveApiError,
  findChildFolder,
  getFileMeta,
  listChildFolderIds,
  moveFile,
  renameFile,
} from "./google-drive";
import {
  linkFolderIdsForProject,
  rehomeLinksFromFolders,
} from "./project-links";

// Google Drive business layer: the app-managed folder hierarchy
//
//   MeetingHub/<Workspace>/Files/            <- the Files nav browses here
//   MeetingHub/<Workspace>/Projects/<Name>/  <- project hub Files tab
//   MeetingHub/<Workspace>/Projects/_archived/
//
// Postgres stores only folder ids (workspaces.drive_*_folder_id,
// projects.drive_folder_id, plus the two app_settings keys below); Drive is
// the source of truth for everything else. All ids are lazily created and
// self-healing: a stored id that turns out deleted/trashed is dropped and the
// folder recreated. IMPORTANT: this module must not import lib/workspaces or
// lib/projects (they call into it for lifecycle hooks) — it queries the
// tables directly instead.

export const DRIVE_ACCOUNT_KEY = "drive_account_id";
export const DRIVE_ROOT_FOLDER_KEY = "drive_root_folder_id";
export const ROOT_FOLDER_NAME = "MeetingHub";

// drive.file = only files/folders this app created. Files dropped into the
// MeetingHub folder via the Drive UI itself are invisible to the app — the
// accepted tradeoff for the narrow, non-restricted scope.
export const DRIVE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
].join(" ");

// One-shot CSRF state cookie for the Drive connect flow — separate from the
// calendar flow's cookie so the two connects can't clobber each other. Lives
// here (not in the route file) because Next's dev-generated route types
// reject non-handler exports from route.ts.
export const DRIVE_OAUTH_STATE_COOKIE = "g_drive_oauth_state";

export function driveRedirectUri(origin: string): string {
  return (
    process.env.GOOGLE_DRIVE_REDIRECT_URI ||
    `${origin}/api/drive/google/callback`
  );
}
const FILES_FOLDER_NAME = "Files";
const PROJECTS_FOLDER_NAME = "Projects";
const ARCHIVED_FOLDER_NAME = "_archived";

export class DriveNotConnectedError extends Error {
  constructor() {
    super("google drive is not connected");
    this.name = "DriveNotConnectedError";
  }
}

// A file id that isn't inside the tree the caller may operate on. Routes map
// this to a plain 404 so ids outside the tree are indistinguishable from
// nonexistent ones.
export class DriveScopeError extends Error {
  constructor() {
    super("file is outside the app-managed tree");
    this.name = "DriveScopeError";
  }
}

export type DriveStatus = {
  configured: boolean;
  connected: SafeGoogleAccount | null;
};

export async function getDriveStatus(): Promise<DriveStatus> {
  const configured = googleConfigured();
  if (!configured) return { configured, connected: null };
  const accountId = await getStringSetting(DRIVE_ACCOUNT_KEY);
  if (!accountId) return { configured, connected: null };
  const account = await getAccountById(accountId);
  if (!account) return { configured, connected: null };
  return {
    configured,
    connected: {
      id: account.id,
      email: account.email,
      createdAt: account.createdAt.toISOString(),
    },
  };
}

// Access token for the designated Drive account. Throws
// GoogleNotConfiguredError / DriveNotConnectedError / GoogleAuthError
// (revoked) — routes map each to its UI state.
export async function getDriveToken(): Promise<string> {
  if (!googleConfigured()) throw new GoogleNotConfiguredError();
  const accountId = await getStringSetting(DRIVE_ACCOUNT_KEY);
  if (!accountId) throw new DriveNotConnectedError();
  const refreshToken = await getRefreshToken(accountId);
  if (!refreshToken) throw new DriveNotConnectedError();
  return accessTokenFromRefresh(refreshToken);
}

// ---- folder hierarchy (lazy, self-healing) ----

async function folderAlive(token: string, id: string): Promise<boolean> {
  try {
    const meta = await getFileMeta(token, id, "id,trashed");
    return !meta.trashed;
  } catch (e) {
    if (e instanceof DriveApiError && e.status === 404) return false;
    throw e;
  }
}

// Verify a stored folder id, else find-by-name, else create. Search-before-
// create because Drive allows duplicate names and out-of-band survivors
// shouldn't spawn twins.
async function ensureFolder(
  token: string,
  parentId: string,
  name: string,
  storedId: string | null,
): Promise<{ id: string; changed: boolean }> {
  if (storedId && (await folderAlive(token, storedId))) {
    return { id: storedId, changed: false };
  }
  const found = await findChildFolder(token, parentId, name);
  const id = found?.id ?? (await createFolder(token, parentId, name)).id;
  return { id, changed: id !== storedId };
}

export async function ensureRootFolder(token: string): Promise<string> {
  const stored = await getStringSetting(DRIVE_ROOT_FOLDER_KEY);
  const { id, changed } = await ensureFolder(
    token,
    "root",
    ROOT_FOLDER_NAME,
    stored,
  );
  if (changed) await setStringSetting(DRIVE_ROOT_FOLDER_KEY, id);
  return id;
}

export type WorkspaceFolders = {
  folderId: string;
  filesFolderId: string;
  projectsFolderId: string;
};

export async function ensureWorkspaceFolders(
  token: string,
  workspace: Workspace,
): Promise<WorkspaceFolders> {
  const rootId = await ensureRootFolder(token);
  const ws = await ensureFolder(
    token,
    rootId,
    workspace.name,
    workspace.driveFolderId,
  );
  const files = await ensureFolder(
    token,
    ws.id,
    FILES_FOLDER_NAME,
    // If the workspace folder itself was recreated, stale child ids fail the
    // alive check (trash cascades) and get recreated under the new parent.
    workspace.driveFilesFolderId,
  );
  const proj = await ensureFolder(
    token,
    ws.id,
    PROJECTS_FOLDER_NAME,
    workspace.driveProjectsFolderId,
  );
  if (ws.changed || files.changed || proj.changed) {
    await db
      .update(workspaces)
      .set({
        driveFolderId: ws.id,
        driveFilesFolderId: files.id,
        driveProjectsFolderId: proj.id,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, workspace.id));
  }
  return { folderId: ws.id, filesFolderId: files.id, projectsFolderId: proj.id };
}

export async function ensureArchivedFolder(
  token: string,
  workspace: Workspace,
): Promise<string> {
  const folders = await ensureWorkspaceFolders(token, workspace);
  const arch = await ensureFolder(
    token,
    folders.projectsFolderId,
    ARCHIVED_FOLDER_NAME,
    workspace.driveArchivedFolderId,
  );
  if (arch.changed) {
    await db
      .update(workspaces)
      .set({ driveArchivedFolderId: arch.id, updatedAt: new Date() })
      .where(eq(workspaces.id, workspace.id));
  }
  return arch.id;
}

export async function ensureProjectFolder(
  token: string,
  project: Project,
  workspace: Workspace,
): Promise<string> {
  const folders = await ensureWorkspaceFolders(token, workspace);
  const folder = await ensureFolder(
    token,
    folders.projectsFolderId,
    project.name,
    project.driveFolderId,
  );
  if (folder.changed) {
    await db
      .update(projects)
      .set({ driveFolderId: folder.id, updatedAt: new Date() })
      .where(eq(projects.id, project.id));
  }
  return folder.id;
}

// ---- protection ----

// Every folder id the app manages for this workspace: the global root, the
// workspace's four, and each project folder. Mutating routes 403 on these —
// their lifecycle belongs to the app.
export async function managedFolderIds(
  workspaceId: string,
): Promise<Set<string>> {
  const ids = new Set<string>();
  const rootId = await getStringSetting(DRIVE_ROOT_FOLDER_KEY);
  if (rootId) ids.add(rootId);
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
  for (const id of [
    ws?.driveFolderId,
    ws?.driveFilesFolderId,
    ws?.driveProjectsFolderId,
    ws?.driveArchivedFolderId,
  ]) {
    if (id) ids.add(id);
  }
  const rows = await db
    .select({ id: projects.driveFolderId })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        isNotNull(projects.driveFolderId),
      ),
    );
  for (const r of rows) if (r.id) ids.add(r.id);
  return ids;
}

// Walk the parent chain until we hit `treeRootId`; throws DriveScopeError if
// the file isn't inside that tree. drive.file scope already limits the blast
// radius to app-created files — this is the belt-and-braces layer that also
// keeps each browser inside its own base folder.
export async function assertInTree(
  token: string,
  treeRootId: string,
  fileId: string,
  maxDepth = 15,
): Promise<void> {
  let current = fileId;
  for (let i = 0; i < maxDepth; i++) {
    if (current === treeRootId) return;
    let meta;
    try {
      meta = await getFileMeta(token, current, "id,parents,trashed");
    } catch (e) {
      if (e instanceof DriveApiError && e.status === 404) {
        throw new DriveScopeError();
      }
      throw e;
    }
    if (meta.trashed) throw new DriveScopeError();
    const parent = meta.parents?.[0];
    if (!parent) throw new DriveScopeError();
    current = parent;
  }
  throw new DriveScopeError();
}

// ---- link placement upkeep (unified Files & Links browser) ----

// A folder id plus every descendant folder id (BFS, depth-capped — project
// trees are small). Used to re-home links when a folder subtree is trashed.
export async function collectFolderTreeIds(
  token: string,
  rootFolderId: string,
  maxDepth = 10,
): Promise<string[]> {
  const all = [rootFolderId];
  let frontier = [rootFolderId];
  for (let depth = 0; depth < maxDepth && frontier.length > 0; depth++) {
    const next = (
      await Promise.all(frontier.map((id) => listChildFolderIds(token, id)))
    ).flat();
    all.push(...next);
    frontier = next;
  }
  return all;
}

// Self-heal for link placements: any link folder that no longer exists (or
// is trashed) in Drive gets nulled so those links surface at the project's
// top level instead of silently disappearing.
export async function healLinkFolders(
  token: string,
  projectId: string,
): Promise<void> {
  const folderIds = await linkFolderIdsForProject(projectId);
  if (folderIds.length === 0) return;
  const alive = await Promise.all(
    folderIds.map((id) => folderAlive(token, id)),
  );
  const dead = folderIds.filter((_, i) => !alive[i]);
  await rehomeLinksFromFolders(dead);
}

// ---- lifecycle hooks (best-effort, never throw) ----
// Called from lib/projects.ts / lib/workspaces.ts after the primary DB write.
// Failures are logged with ids only — never names or content.

async function tokenIfConnected(): Promise<string | null> {
  if (!googleConfigured()) return null;
  try {
    return await getDriveToken();
  } catch {
    return null;
  }
}

// Move a deleted project's folder to <workspace>/Projects/_archived/.
export async function tryArchiveProjectFolder(
  project: Pick<Project, "id" | "workspaceId" | "driveFolderId">,
): Promise<void> {
  if (!project.driveFolderId) return;
  try {
    const token = await tokenIfConnected();
    if (!token) return;
    if (!(await folderAlive(token, project.driveFolderId))) return;
    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, project.workspaceId));
    if (!ws) return;
    const archivedId = await ensureArchivedFolder(token, ws);
    await moveFile(token, project.driveFolderId, archivedId);
  } catch {
    console.warn("drive: failed to archive project folder", {
      projectId: project.id,
      driveFolderId: project.driveFolderId,
    });
  }
}

// Keep a project's/workspace's Drive folder name in sync after a rename.
export async function tryRenameDriveFolder(
  driveFolderId: string | null,
  newName: string,
  logCtx: Record<string, string>,
): Promise<void> {
  if (!driveFolderId) return;
  try {
    const token = await tokenIfConnected();
    if (!token) return;
    await renameFile(token, driveFolderId, newName);
  } catch {
    console.warn("drive: failed to rename folder", {
      ...logCtx,
      driveFolderId,
    });
  }
}
