import { NextResponse } from "next/server";
import type { RelationFailure } from "@/lib/project-relations";

export { guardProject } from "../_lib/project-guard";

const MESSAGES: Record<RelationFailure | "bad-meeting", string> = {
  self: "a project cannot relate to itself",
  "not-found": "project not found",
  duplicate: "these projects are already connected",
  cycle: "would create a circular dependency",
  "cross-workspace": "projects are in different workspaces",
  "bad-meeting": "meeting not found in this workspace",
};

// 404 for a missing project so the status matches guardProject and the by-id
// routes; a client shouldn't see two answers for one condition.
const STATUS: Record<RelationFailure | "bad-meeting", number> = {
  self: 400,
  "not-found": 404,
  duplicate: 409,
  cycle: 409,
  "cross-workspace": 400,
  "bad-meeting": 400,
};

export function relationError(
  reason: RelationFailure | "bad-meeting",
): NextResponse {
  return NextResponse.json(
    { error: MESSAGES[reason] },
    { status: STATUS[reason] },
  );
}
