import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/projects";
import {
  checkFeature,
  err,
  readJsonBody,
  resolveWorkspace,
  withV1,
} from "../_lib/helpers";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = withV1({}, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "projects");
  if (disabled) return disabled;

  const params = new URL(req.url).searchParams;
  const includeArchived = params.get("includeArchived") === "true";
  const includeParked = params.get("includeParked") === "true";
  const items = await listProjects(ws.workspace.id, {
    includeArchived,
    includeParked,
  });
  return NextResponse.json({ items });
});

export const POST = withV1({ write: true }, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "projects");
  if (disabled) return disabled;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const { name, description, deadline } = (parsed.body ?? {}) as {
    name?: unknown;
    description?: unknown;
    deadline?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    return err("name is required", 400);
  }
  if (deadline !== undefined && deadline !== null) {
    if (typeof deadline !== "string" || !DATE_RE.test(deadline)) {
      return err("deadline must be YYYY-MM-DD", 400);
    }
  }

  const item = await createProject(ws.workspace.id, {
    name: name.trim(),
    description: typeof description === "string" ? description : undefined,
    deadline: typeof deadline === "string" ? deadline : undefined,
  });
  return NextResponse.json({ item }, { status: 201 });
});
