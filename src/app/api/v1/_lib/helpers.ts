import { NextResponse } from "next/server";
import { verifyApiToken, type ApiPrincipal } from "@/lib/api-tokens";
import { getWorkspaceById, isFeatureEnabled } from "@/lib/workspaces";
import { getProject } from "@/lib/projects";
import { getMilestone } from "@/lib/milestones";
import type { Workspace, WorkspaceFeature } from "@/db/schema";

// The /api/v1 surface is bearer-token-only: excluded from the session
// middleware (see src/middleware.ts), authenticated per-request against the
// api_tokens table. Workspace scope comes from the token + ?workspace= param —
// never from the mh_workspace cookie (that's UI state).

export function err(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

type Ctx = { params: Promise<Record<string, string>> };
type V1Handler = (
  req: Request,
  ctx: Ctx,
  principal: ApiPrincipal,
) => Promise<Response>;

// Wrapper keeping handlers thin: bearer parse + verify (401), write-scope
// enforcement (403), unexpected throws → 500.
export function withV1(
  opts: { write?: boolean },
  handler: V1Handler,
): (req: Request, ctx: Ctx) => Promise<Response> {
  return async (req, ctx) => {
    const header = req.headers.get("authorization") ?? "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : "";
    const principal = bearer ? await verifyApiToken(bearer) : null;
    if (!principal) return err("unauthorized", 401);
    if (opts.write && principal.scope !== "write") {
      return err("token is read-only", 403);
    }
    try {
      return await handler(req, ctx, principal);
    } catch (e) {
      console.error("[api/v1] unhandled error:", e);
      return err("internal error", 500);
    }
  };
}

export function isWorkspaceAllowed(
  p: ApiPrincipal,
  workspaceId: string,
): boolean {
  return (
    p.allowedWorkspaceIds === null ||
    p.allowedWorkspaceIds.includes(workspaceId)
  );
}

type WorkspaceResult =
  | { ok: true; workspace: Workspace }
  | { ok: false; res: Response };

// Collection routes (list/create): the target workspace comes from
// ?workspace=<uuid>. A token restricted to exactly one workspace may omit it.
export async function resolveWorkspace(
  req: Request,
  p: ApiPrincipal,
): Promise<WorkspaceResult> {
  const param = new URL(req.url).searchParams.get("workspace");
  if (param) {
    if (!isWorkspaceAllowed(p, param)) {
      return { ok: false, res: err("workspace not allowed", 403) };
    }
    const workspace = await getWorkspaceById(param);
    if (!workspace) return { ok: false, res: err("workspace not found", 404) };
    return { ok: true, workspace };
  }
  if (p.allowedWorkspaceIds?.length === 1) {
    const workspace = await getWorkspaceById(p.allowedWorkspaceIds[0]);
    if (!workspace) return { ok: false, res: err("workspace not found", 404) };
    return { ok: true, workspace };
  }
  return { ok: false, res: err("workspace query param required", 400) };
}

// Id routes: after fetching a row, check its workspace against the token.
// Outside the allowed set → 404 (not 403), so tokens can't probe for the
// existence of rows in workspaces they can't see.
export async function checkRowWorkspace(
  p: ApiPrincipal,
  workspaceId: string,
): Promise<WorkspaceResult> {
  if (!isWorkspaceAllowed(p, workspaceId)) {
    return { ok: false, res: err("not found", 404) };
  }
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return { ok: false, res: err("not found", 404) };
  return { ok: true, workspace };
}

// Feature-toggle enforcement, mirroring the 403 on /api/calendar/import.
// Tasks pass null — always on.
export function checkFeature(
  workspace: Workspace,
  feature: WorkspaceFeature | null,
): Response | null {
  if (feature === null || isFeatureEnabled(workspace, feature)) return null;
  return err(`${feature} is disabled in this workspace`, 403);
}

// Cross-workspace reference guard for writes: a projectId/milestoneId in the
// body must resolve inside the target workspace. The session routes get this
// for free from the cookie-scoped UI; token requests must prove it.
export async function checkRefsInWorkspace(
  workspaceId: string,
  refs: { projectId?: string | null; milestoneId?: string | null },
): Promise<Response | null> {
  if (refs.projectId) {
    const project = await getProject(refs.projectId);
    if (!project || project.workspaceId !== workspaceId) {
      return err("projectId not in workspace", 400);
    }
  }
  if (refs.milestoneId) {
    const milestone = await getMilestone(refs.milestoneId);
    const project = milestone ? await getProject(milestone.projectId) : null;
    if (!project || project.workspaceId !== workspaceId) {
      return err("milestoneId not in workspace", 400);
    }
  }
  return null;
}

// Body guard modeled on /api/ingest: Content-Length fast-reject, then a byte
// check on the actual body, then JSON parse. 1 MB default covers the largest
// legitimate input (a full note body) with room to spare.
const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export async function readJsonBody(
  req: Request,
  maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<{ ok: true; body: unknown } | { ok: false; res: Response }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) {
    return { ok: false, res: err("payload too large", 413) };
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return { ok: false, res: err("invalid body", 400) };
  }
  if (Buffer.byteLength(raw, "utf8") > maxBytes) {
    return { ok: false, res: err("payload too large", 413) };
  }
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, res: err("invalid json", 400) };
  }
}
