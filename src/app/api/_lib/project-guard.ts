import { NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { getWorkspaceById, isFeatureEnabled } from "@/lib/workspaces";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

// Shared gate for session routes that take a projectId from the caller.
// Scope comes from the project's OWN workspace (deep-link safe, matching the
// detail pages) — but a project outside the active workspace is still refused,
// so a stray id from another life area can't leak content into the one you're
// looking at. Returns a response to bail with, or null to continue.
export async function guardProject(
  projectId: string,
  opts: { requireActiveWorkspace?: boolean } = {},
): Promise<NextResponse | null> {
  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }
  const workspace = await getWorkspaceById(project.workspaceId);
  if (!workspace || !isFeatureEnabled(workspace, "projects")) {
    return NextResponse.json(
      { error: "projects are disabled in this workspace" },
      { status: 403 },
    );
  }
  if (opts.requireActiveWorkspace) {
    const activeId = await getActiveWorkspaceId();
    if (project.workspaceId !== activeId) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }
  }
  return null;
}
