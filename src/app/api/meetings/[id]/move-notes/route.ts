import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { moveGeneratedNotes } from "@/lib/meetings";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Move this meeting's generated (Notes+) notes onto another meeting.
// Body: { targetMeetingId }.
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
  const { targetMeetingId } = (body ?? {}) as { targetMeetingId?: unknown };
  if (typeof targetMeetingId !== "string" || !targetMeetingId) {
    return NextResponse.json(
      { error: "targetMeetingId required" },
      { status: 400 },
    );
  }

  const result = await moveGeneratedNotes(id, targetMeetingId);
  if (result.ok) return NextResponse.json({ ok: true, meetingId: targetMeetingId });

  const status =
    result.reason === "not-found"
      ? 404
      : result.reason === "target-occupied"
        ? 409
        : 400;
  return NextResponse.json({ error: result.reason }, { status });
});
