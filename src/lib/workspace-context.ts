import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { Workspace } from "@/db/schema";
import { getDefaultWorkspace, getWorkspaceById } from "@/lib/workspaces";

// The active workspace lives in a plain httpOnly cookie set by
// POST /api/workspaces/active. Server components and route handlers both read
// it through here — never directly — so validation and the default-workspace
// fallback (missing cookie, deleted workspace) apply everywhere.
export const WORKSPACE_COOKIE = "mh_workspace";

// cache(): one cookie read + validation per request, shared by the layout,
// page, and any nested calls in the same render.
export const getActiveWorkspace = cache(async (): Promise<Workspace> => {
  const jar = await cookies();
  const id = jar.get(WORKSPACE_COOKIE)?.value;
  if (id) {
    const w = await getWorkspaceById(id);
    if (w) return w;
  }
  return getDefaultWorkspace();
});

export async function getActiveWorkspaceId(): Promise<string> {
  return (await getActiveWorkspace()).id;
}
