import { NextResponse } from "next/server";
import {
  createNote,
  getNote,
  listNotesWithAttachments,
  saveNoteBody,
} from "@/lib/notes";
import {
  checkFeature,
  err,
  readJsonBody,
  resolveWorkspace,
  withV1,
} from "../_lib/helpers";

export const dynamic = "force-dynamic";

// List items are summaries (title, attached project names, meeting count) —
// fetch a note by id for the full body.
export const GET = withV1({}, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "notes");
  if (disabled) return disabled;

  const items = await listNotesWithAttachments(ws.workspace.id);
  return NextResponse.json({ items });
});

// v1 keeps notes simple: title + body, plus an optional same-workspace
// project/meeting attach at creation. No attachment management endpoints.
export const POST = withV1({ write: true }, async (req, _ctx, principal) => {
  const ws = await resolveWorkspace(req, principal);
  if (!ws.ok) return ws.res;
  const disabled = checkFeature(ws.workspace, "notes");
  if (disabled) return disabled;

  const parsed = await readJsonBody(req);
  if (!parsed.ok) return parsed.res;
  const { title, body, projectId, meetingId } = (parsed.body ?? {}) as {
    title?: unknown;
    body?: unknown;
    projectId?: unknown;
    meetingId?: unknown;
  };

  if (title !== undefined && typeof title !== "string") {
    return err("title must be a string", 400);
  }
  if (body !== undefined && typeof body !== "string") {
    return err("body must be a string", 400);
  }

  const note = await createNote(ws.workspace.id, {
    title: typeof title === "string" ? title : undefined,
    projectId: typeof projectId === "string" ? projectId : undefined,
    meetingId: typeof meetingId === "string" ? meetingId : undefined,
  });
  if (typeof body === "string" && body !== "") {
    await saveNoteBody(note.id, body, null);
  }
  return NextResponse.json({ item: await getNote(note.id) }, { status: 201 });
});
