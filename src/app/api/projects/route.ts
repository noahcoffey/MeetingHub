import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createProject, listProjects } from "@/lib/projects";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "1";
  const workspaceId = await getActiveWorkspaceId();
  const items = await listProjects(workspaceId, { includeArchived });
  return NextResponse.json({ items });
});

export const POST = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { name, description, deadline } = (body ?? {}) as {
    name?: unknown;
    description?: unknown;
    deadline?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const deadlineVal =
    typeof deadline === "string" && DATE_RE.test(deadline) ? deadline : null;

  const workspaceId = await getActiveWorkspaceId();
  const item = await createProject(workspaceId, {
    name: name.trim(),
    description: typeof description === "string" ? description.trim() : "",
    deadline: deadlineVal,
  });
  return NextResponse.json({ item }, { status: 201 });
});
