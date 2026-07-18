import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addDependency, listDependencyEdges } from "@/lib/task-dependencies";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const workspaceId = await getActiveWorkspaceId();
  const edges = await listDependencyEdges(workspaceId);
  return NextResponse.json({ edges });
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

  const { taskId, dependsOnId } = (body ?? {}) as {
    taskId?: unknown;
    dependsOnId?: unknown;
  };

  if (typeof taskId !== "string" || !taskId) {
    return NextResponse.json({ error: "taskId is required" }, { status: 400 });
  }
  if (typeof dependsOnId !== "string" || !dependsOnId) {
    return NextResponse.json({ error: "dependsOnId is required" }, { status: 400 });
  }

  const result = await addDependency(taskId, dependsOnId);
  if (!result.ok) {
    if (result.reason === "self") {
      return NextResponse.json(
        { error: "a task cannot depend on itself" },
        { status: 400 },
      );
    }
    if (result.reason === "not-found") {
      return NextResponse.json({ error: "task not found" }, { status: 400 });
    }
    if (result.reason === "duplicate") {
      return NextResponse.json(
        { error: "dependency already exists" },
        { status: 409 },
      );
    }
    if (result.reason === "cross-workspace") {
      return NextResponse.json(
        { error: "tasks are in different workspaces" },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: "would create a circular dependency" },
      { status: 409 },
    );
  }
  return NextResponse.json({ edge: result.edge }, { status: 201 });
});
