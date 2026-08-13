import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  addRelation,
  getProjectMap,
  listRelationEdges,
  listRelationsForProject,
} from "@/lib/project-relations";
import { getActiveWorkspaceId } from "@/lib/workspace-context";
import { projectRelationKindEnum } from "@/db/schema";
import type { ProjectRelationKind } from "@/db/schema";
import { guardProject, relationError } from "./_lib";

export const dynamic = "force-dynamic";

const KINDS = projectRelationKindEnum.enumValues;

function isKind(v: unknown): v is ProjectRelationKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

// ?map=<projectId>&depth=1|2 -> the radial map payload for the hub tab.
// ?projectId=<id>            -> every edge touching that project.
// bare                       -> all edges in the active workspace.
export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const mapId = url.searchParams.get("map");
  const projectId = url.searchParams.get("projectId");

  if (mapId) {
    const denied = await guardProject(mapId);
    if (denied) return denied;
    const depth = url.searchParams.get("depth") === "2" ? 2 : 1;
    const map = await getProjectMap(mapId, { depth });
    if (!map) {
      return NextResponse.json({ error: "project not found" }, { status: 404 });
    }
    return NextResponse.json(map);
  }

  if (projectId) {
    const denied = await guardProject(projectId);
    if (denied) return denied;
    const relations = await listRelationsForProject(projectId);
    return NextResponse.json({ relations });
  }

  const workspaceId = await getActiveWorkspaceId();
  const edges = await listRelationEdges(workspaceId);
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

  const { fromId, toId, kind, note, createdInMeetingId } = (body ?? {}) as {
    fromId?: unknown;
    toId?: unknown;
    kind?: unknown;
    note?: unknown;
    createdInMeetingId?: unknown;
  };

  if (typeof fromId !== "string" || !fromId) {
    return NextResponse.json({ error: "fromId is required" }, { status: 400 });
  }
  if (typeof toId !== "string" || !toId) {
    return NextResponse.json({ error: "toId is required" }, { status: 400 });
  }
  if (kind !== undefined && !isKind(kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }

  const denied = await guardProject(fromId);
  if (denied) return denied;

  const result = await addRelation({
    fromId,
    toId,
    kind: kind ?? "related",
    note: typeof note === "string" ? note : null,
    createdInMeetingId:
      typeof createdInMeetingId === "string" ? createdInMeetingId : null,
  });
  if (!result.ok) return relationError(result.reason);
  return NextResponse.json({ relation: result.relation }, { status: 201 });
});
