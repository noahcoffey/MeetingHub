import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deleteMeeting,
  getMeeting,
  saveMeetingNotes,
  updateGeneratedNotes,
  updateMeetingMeta,
} from "@/lib/meetings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  const meeting = await getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ meeting });
});

export const DELETE = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;
  const meeting = await getMeeting(id);
  if (!meeting) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  // Calendar events re-import on the next sync; only manual meetings are deletable.
  if (meeting.source !== "manual") {
    return NextResponse.json(
      { error: "only manual meetings can be deleted" },
      { status: 400 },
    );
  }
  await deleteMeeting(id);
  return NextResponse.json({ ok: true });
});

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

  const {
    notes,
    baseNotesUpdatedAt,
    notesGenerated,
    title,
    startTime,
    endTime,
    projectId,
    untaggedDismissed,
  } = (body ?? {}) as {
    notes?: unknown;
    baseNotesUpdatedAt?: unknown;
    notesGenerated?: unknown;
    title?: unknown;
    startTime?: unknown;
    endTime?: unknown;
    projectId?: unknown;
    untaggedDismissed?: unknown;
  };

  // Generated-notes edit path.
  if (typeof notesGenerated === "string") {
    await updateGeneratedNotes(id, notesGenerated);
    return NextResponse.json({ ok: true });
  }

  // Notes autosave path (with optimistic-concurrency check).
  if (typeof notes === "string") {
    const base =
      typeof baseNotesUpdatedAt === "string"
        ? new Date(baseNotesUpdatedAt)
        : null;
    const result = await saveMeetingNotes(
      id,
      notes,
      base && !Number.isNaN(base.getTime()) ? base : null,
    );
    if (result === null) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!result.ok) {
      return NextResponse.json(
        {
          conflict: true,
          notes: result.notes,
          notesUpdatedAt: result.notesUpdatedAt.toISOString(),
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      notesUpdatedAt: result.notesUpdatedAt.toISOString(),
    });
  }

  // Meta update path (title / time / project / triage dismissal).
  const patch: {
    title?: string;
    startTime?: Date;
    endTime?: Date | null;
    projectId?: string | null;
    untaggedDismissedAt?: Date;
  } = {};
  // "Doesn't need a project" — hides the meeting from the Projects triage inbox.
  if (untaggedDismissed === true) patch.untaggedDismissedAt = new Date();
  if (typeof title === "string" && title.trim() !== "") {
    patch.title = title.trim();
  }
  if (typeof startTime === "string") {
    const s = new Date(startTime);
    if (!Number.isNaN(s.getTime())) patch.startTime = s;
  }
  if (typeof endTime === "string") {
    const e = new Date(endTime);
    if (!Number.isNaN(e.getTime())) patch.endTime = e;
  } else if (endTime === null) {
    patch.endTime = null;
  }
  if (projectId === null) patch.projectId = null;
  else if (typeof projectId === "string") patch.projectId = projectId;

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  const meeting = await updateMeetingMeta(id, patch);
  if (!meeting) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ meeting });
});
