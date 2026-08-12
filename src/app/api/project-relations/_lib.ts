import { NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { getWorkspaceById, isFeatureEnabled } from "@/lib/workspaces";
import type { RelationFailure } from "@/lib/project-relations";

// Relations hang off projects, so scope comes from the project's OWN workspace
// (deep-link safe, matching the detail pages) rather than the active-workspace
// cookie. Returns a response to bail with, or null to continue.
export async function guardProject(
  projectId: string,
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
  return null;
}

const MESSAGES: Record<RelationFailure | "bad-meeting", string> = {
  self: "a project cannot relate to itself",
  "not-found": "project not found",
  duplicate: "these projects are already connected",
  cycle: "would create a circular dependency",
  "cross-workspace": "projects are in different workspaces",
  "bad-meeting": "meeting not found in this workspace",
};

export function relationError(
  reason: RelationFailure | "bad-meeting",
): NextResponse {
  const status = reason === "duplicate" || reason === "cycle" ? 409 : 400;
  return NextResponse.json({ error: MESSAGES[reason] }, { status });
}
