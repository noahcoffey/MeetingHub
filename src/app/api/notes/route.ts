import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { createNote } from "@/lib/notes";
import { getActiveWorkspaceId } from "@/lib/workspace-context";

export const dynamic = "force-dynamic";

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

  const { title, projectId, meetingId } = (body ?? {}) as {
    title?: unknown;
    projectId?: unknown;
    meetingId?: unknown;
  };

  const workspaceId = await getActiveWorkspaceId();
  try {
    const note = await createNote(workspaceId, {
      title: typeof title === "string" ? title.trim() : undefined,
      projectId: typeof projectId === "string" ? projectId : undefined,
      meetingId: typeof meetingId === "string" ? meetingId : undefined,
    });
    return NextResponse.json({ note }, { status: 201 });
  } catch {
    // FK violation — nonexistent project/meeting.
    return NextResponse.json({ error: "invalid target" }, { status: 400 });
  }
});
