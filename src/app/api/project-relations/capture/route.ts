import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { captureRelatedProject } from "@/lib/project-relations";
import { projectRelationKindEnum } from "@/db/schema";
import type { ProjectRelationKind } from "@/db/schema";
import { guardProject, relationError } from "../_lib";

export const dynamic = "force-dynamic";

const KINDS = projectRelationKindEnum.enumValues;

function isKind(v: unknown): v is ProjectRelationKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

// Mid-meeting capture: create a parked project AND its edge in one request, so
// a failure can't strand an unconnected parked project. Static segment, so it
// never collides with the sibling [id] route.
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

  const { fromProjectId, name, kind, note, meetingId } = (body ?? {}) as {
    fromProjectId?: unknown;
    name?: unknown;
    kind?: unknown;
    note?: unknown;
    meetingId?: unknown;
  };

  if (typeof fromProjectId !== "string" || !fromProjectId) {
    return NextResponse.json(
      { error: "fromProjectId is required" },
      { status: 400 },
    );
  }
  if (typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (kind !== undefined && !isKind(kind)) {
    return NextResponse.json({ error: "invalid kind" }, { status: 400 });
  }

  const denied = await guardProject(fromProjectId);
  if (denied) return denied;

  const result = await captureRelatedProject({
    fromProjectId,
    name: name.trim(),
    kind: kind ?? "related",
    note: typeof note === "string" ? note : null,
    meetingId: typeof meetingId === "string" ? meetingId : null,
  });
  if (!result.ok) return relationError(result.reason);
  return NextResponse.json(
    { project: result.project, relation: result.relation },
    { status: 201 },
  );
});
