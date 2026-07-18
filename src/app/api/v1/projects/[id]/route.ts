import { NextResponse } from "next/server";
import { getProject, updateProject } from "@/lib/projects";
import {
  checkFeature,
  checkRowWorkspace,
  err,
  readJsonBody,
  withV1,
} from "../../_lib/helpers";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ["active", "archived"] as const;
type Status = (typeof STATUSES)[number];

export const GET = withV1({}, async (_req, ctx, principal) => {
  const { id } = await ctx.params;
  const item = await getProject(id);
  if (!item) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, item.workspaceId);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "projects");
  if (disabled) return disabled;
  return NextResponse.json({ item });
});

export const PATCH = withV1({ write: true }, async (req, ctx, principal) => {
  const { id } = await ctx.params;
  const existing = await getProject(id);
  if (!existing) return err("not found", 404);
  const ws = await checkRowWorkspace(principal, existing.workspaceId);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "projects");
  if (disabled) return disabled;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const { name, description, deadline, status } = (parsed.body ?? {}) as {
    name?: unknown;
    description?: unknown;
    deadline?: unknown;
    status?: unknown;
  };

  const patch: {
    name?: string;
    description?: string;
    deadline?: string | null;
    status?: Status;
  } = {};
  if (typeof name === "string" && name.trim() !== "") patch.name = name.trim();
  if (typeof description === "string") patch.description = description;
  if (deadline === null) patch.deadline = null;
  else if (typeof deadline === "string" && DATE_RE.test(deadline)) {
    patch.deadline = deadline;
  }
  if (STATUSES.includes(status as Status)) patch.status = status as Status;

  if (Object.keys(patch).length === 0) return err("nothing to update", 400);

  const item = await updateProject(id, patch);
  return NextResponse.json({ item });
});
