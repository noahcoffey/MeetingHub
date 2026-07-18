import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createMilestone } from "@/lib/milestones";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const { projectId, name, dueDate } = (body ?? {}) as {
    projectId?: unknown;
    name?: unknown;
    dueDate?: unknown;
  };

  if (typeof projectId !== "string" || !projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const milestone = await createMilestone({
    projectId,
    name: name.trim(),
    dueDate: typeof dueDate === "string" && DATE_RE.test(dueDate) ? dueDate : null,
  });
  return NextResponse.json({ milestone }, { status: 201 });
});
