import { NextResponse } from "next/server";
import { getProject } from "@/lib/projects";
import { createMilestone, listMilestonesForProject } from "@/lib/milestones";
import {
  checkFeature,
  checkRowWorkspace,
  err,
  readJsonBody,
  withV1,
} from "../../../_lib/helpers";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Milestones carry no workspace_id — scope is inherited via the parent project.
export const GET = withV1({}, async (_req, ctx, principal) => {
  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, project.workspaceId);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "projects");
  if (disabled) return disabled;

  const items = await listMilestonesForProject(id);
  return NextResponse.json({ items });
});

export const POST = withV1({ write: true }, async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const project = await getProject(id);
  if (!project) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, project.workspaceId);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "projects");
  if (disabled) return disabled;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const { name, dueDate } = (parsed.body ?? {}) as {
    name?: unknown;
    dueDate?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    return err("name is required", 400);
  }
  if (dueDate !== undefined && dueDate !== null) {
    if (typeof dueDate !== "string" || !DATE_RE.test(dueDate)) {
      return err("dueDate must be YYYY-MM-DD", 400);
    }
  }

  const item = await createMilestone({
    projectId: id,
    name: name.trim(),
    dueDate: typeof dueDate === "string" ? dueDate : null,
  });
  return NextResponse.json({ item }, { status: 201 });
});
