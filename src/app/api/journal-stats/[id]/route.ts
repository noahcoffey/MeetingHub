import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteStat,
  getStatById,
  setStatArchived,
  updateStat,
  type StatDirection,
} from "@/lib/journal-stats";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const DIRECTIONS: StatDirection[] = ["good", "bad", "neutral"];

// Guard: the stat must exist and belong to the active workspace.
async function authorize(id: string) {
  const stat = await getStatById(id);
  if (!stat) return { error: "not found" as const, status: 404 };
  const workspaceId = await getActiveWorkspaceId();
  if (stat.workspaceId !== workspaceId) {
    return { error: "not found" as const, status: 404 };
  }
  return { stat };
}

export const PATCH = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  const gate = await authorize(id);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { name, direction, config, showOnDashboard, archived } = (body ??
    {}) as {
    name?: unknown;
    direction?: unknown;
    config?: unknown;
    showOnDashboard?: unknown;
    archived?: unknown;
  };

  // Archive toggle is handled separately from field edits.
  if (typeof archived === "boolean") {
    const item = await setStatArchived(id, archived);
    return NextResponse.json({ item });
  }

  const patch: Parameters<typeof updateStat>[1] = {};
  if (typeof name === "string" && name.trim() !== "") patch.name = name.trim();
  if (
    typeof direction === "string" &&
    DIRECTIONS.includes(direction as StatDirection)
  )
    patch.direction = direction as StatDirection;
  if (typeof showOnDashboard === "boolean")
    patch.showOnDashboard = showOnDashboard;
  if (config !== undefined) patch.config = config;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  const item = await updateStat(id, patch);
  return NextResponse.json({ item });
});

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  const gate = await authorize(id);
  if ("error" in gate) {
    return NextResponse.json({ error: gate.error }, { status: gate.status });
  }
  await deleteStat(id);
  return NextResponse.json({ ok: true });
});
