import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createWorkspace, listWorkspaces } from "@/lib/workspaces";

export const dynamic = "force-dynamic";

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const items = (await listWorkspaces()).map((w) => ({
    id: w.id,
    name: w.name,
    icsUrl: w.icsUrl,
    isDefault: w.isDefault,
    sortOrder: w.sortOrder,
    disabledFeatures: w.disabledFeatures,
  }));
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

  const { name } = (body ?? {}) as { name?: unknown };
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const w = await createWorkspace(name.trim());
  const item = {
    id: w.id,
    name: w.name,
    icsUrl: w.icsUrl,
    isDefault: w.isDefault,
    sortOrder: w.sortOrder,
    disabledFeatures: w.disabledFeatures,
  };
  return NextResponse.json({ item }, { status: 201 });
});
