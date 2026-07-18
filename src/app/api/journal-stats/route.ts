import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  createStat,
  listStats,
  reorderStats,
  type StatDirection,
  type StatType,
} from "@/lib/journal-stats";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

const TYPES: StatType[] = ["scale", "number", "boolean", "text"];
const DIRECTIONS: StatDirection[] = ["good", "bad", "neutral"];

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const includeArchived =
    new URL(req.url).searchParams.get("includeArchived") === "1";
  const workspaceId = await getActiveWorkspaceId();
  const items = await listStats(workspaceId, { includeArchived });
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

  const { name, type, direction, config, showOnDashboard } = (body ?? {}) as {
    name?: unknown;
    type?: unknown;
    direction?: unknown;
    config?: unknown;
    showOnDashboard?: unknown;
  };

  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (typeof type !== "string" || !TYPES.includes(type as StatType)) {
    return NextResponse.json(
      { error: "type must be one of scale|number|boolean|text" },
      { status: 400 },
    );
  }
  const dir =
    typeof direction === "string" && DIRECTIONS.includes(direction as StatDirection)
      ? (direction as StatDirection)
      : "neutral";

  const workspaceId = await getActiveWorkspaceId();
  const item = await createStat(workspaceId, {
    name: name.trim(),
    type: type as StatType,
    direction: dir,
    config,
    showOnDashboard: showOnDashboard === true,
  });
  return NextResponse.json({ item }, { status: 201 });
});

// Reorder the workspace's stats: body { orderedIds: string[] }.
export const PATCH = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const { orderedIds } = (body ?? {}) as { orderedIds?: unknown };
  if (
    !Array.isArray(orderedIds) ||
    !orderedIds.every((id) => typeof id === "string")
  ) {
    return NextResponse.json(
      { error: "orderedIds must be an array of ids" },
      { status: 400 },
    );
  }
  const workspaceId = await getActiveWorkspaceId();
  await reorderStats(workspaceId, orderedIds as string[]);
  return NextResponse.json({ ok: true });
});
