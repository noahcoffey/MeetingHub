import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  attachMeeting,
  attachProject,
  detachMeeting,
  detachProject,
  getNote,
} from "@/lib/notes";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Body is { projectId } or { meetingId } — exactly one.
function parseTarget(body: unknown):
  | { kind: "project" | "meeting"; targetId: string }
  | null {
  const { projectId, meetingId } = (body ?? {}) as {
    projectId?: unknown;
    meetingId?: unknown;
  };
  const hasProject = typeof projectId === "string" && projectId !== "";
  const hasMeeting = typeof meetingId === "string" && meetingId !== "";
  if (hasProject === hasMeeting) return null;
  return hasProject
    ? { kind: "project", targetId: projectId as string }
    : { kind: "meeting", targetId: meetingId as string };
}

export const POST = auth(async (req, ctx) => {
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
  const target = parseTarget(body);
  if (!target) {
    return NextResponse.json(
      { error: "exactly one of projectId or meetingId is required" },
      { status: 400 },
    );
  }
  if (!(await getNote(id))) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  try {
    const attached =
      target.kind === "project"
        ? await attachProject(id, target.targetId)
        : await attachMeeting(id, target.targetId);
    if (!attached) {
      // Nonexistent target or cross-workspace attachment — rejected.
      return NextResponse.json({ error: "invalid target" }, { status: 400 });
    }
  } catch {
    // FK violation — nonexistent project/meeting.
    return NextResponse.json({ error: "invalid target" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
});

export const DELETE = auth(async (req, ctx) => {
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
  const target = parseTarget(body);
  if (!target) {
    return NextResponse.json(
      { error: "exactly one of projectId or meetingId is required" },
      { status: 400 },
    );
  }

  if (target.kind === "project") await detachProject(id, target.targetId);
  else await detachMeeting(id, target.targetId);
  return NextResponse.json({ ok: true });
});
