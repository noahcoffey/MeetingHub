import { NextResponse } from "next/server";
import { getMilestone, updateMilestone } from "@/lib/milestones";
import { getProject } from "@/lib/projects";
import {
  checkFeature,
  checkRowWorkspace,
  err,
  readJsonBody,
  withV1,
} from "../../_lib/helpers";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Resolution chain: milestone → parent project → workspace check.
async function resolveMilestone(id: string) {
  const milestone = await getMilestone(id);
  if (!milestone) return null;
  const project = await getProject(milestone.projectId);
  if (!project) return null;
  return { milestone, project };
}

export const GET = withV1({}, async (_req, ctx, principal) => {
  const { id } = await ctx.params;
  const found = await resolveMilestone(id);
  if (!found) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, found.project.workspaceId);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "projects");
  if (disabled) return disabled;
  return NextResponse.json({ item: found.milestone });
});

export const PATCH = withV1({ write: true }, async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const found = await resolveMilestone(id);
  if (!found) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, found.project.workspaceId);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "projects");
  if (disabled) return disabled;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const { name, dueDate, completed } = (parsed.body ?? {}) as {
    name?: unknown;
    dueDate?: unknown;
    completed?: unknown;
  };

  const patch: { name?: string; dueDate?: string | null; completed?: boolean } =
    {};
  if (typeof name === "string" && name.trim() !== "") patch.name = name.trim();
  if (dueDate === null) patch.dueDate = null;
  else if (typeof dueDate === "string" && DATE_RE.test(dueDate)) {
    patch.dueDate = dueDate;
  }
  if (typeof completed === "boolean") patch.completed = completed;

  if (Object.keys(patch).length === 0) return err("nothing to update", 400);

  const item = await updateMilestone(id, patch);
  return NextResponse.json({ item });
});
