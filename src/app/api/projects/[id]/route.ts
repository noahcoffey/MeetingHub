import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteProject, getProject, updateProject } from "@/lib/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const STATUSES = ["active", "archived", "parked"] as const;
type Status = (typeof STATUSES)[number];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  const item = await getProject(id);
  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ item });
});

export const PATCH = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { name, description, deadline, status } = (body ?? {}) as {
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

  if (typeof name === "string" && name.trim() !== "") {
    patch.name = name.trim();
  }
  if (typeof description === "string") patch.description = description.trim();
  if (deadline === null) patch.deadline = null;
  else if (typeof deadline === "string" && DATE_RE.test(deadline)) {
    patch.deadline = deadline;
  }
  if (STATUSES.includes(status as Status)) patch.status = status as Status;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const item = await updateProject(id, patch);
  if (!item) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ item });
});

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await deleteProject(id);
  return NextResponse.json({ ok: true });
});
