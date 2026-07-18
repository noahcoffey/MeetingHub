import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { deleteMilestone, updateMilestone } from "@/lib/milestones";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Ctx = { params: Promise<{ id: string }> };

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

  const { name, dueDate, completed } = (body ?? {}) as {
    name?: unknown;
    dueDate?: unknown;
    completed?: unknown;
  };

  const patch: { name?: string; dueDate?: string | null; completed?: boolean } =
    {};
  if (typeof name === "string" && name.trim() !== "") patch.name = name.trim();
  // Explicit null clears the date (same convention as action-items PATCH).
  if (dueDate === null) patch.dueDate = null;
  else if (typeof dueDate === "string" && DATE_RE.test(dueDate)) {
    patch.dueDate = dueDate;
  }
  if (typeof completed === "boolean") patch.completed = completed;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const milestone = await updateMilestone(id, patch);
  if (!milestone) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ milestone });
});

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  await deleteMilestone(id);
  return NextResponse.json({ ok: true });
});
