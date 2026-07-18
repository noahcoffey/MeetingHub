import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { search } from "@/lib/search";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { getHideGeneratedNotes } from "@/lib/app-settings";
import { formatTimeInTz, formatDateInTz, APP_TIMEZONE } from "@/lib/dates";

export const dynamic = "force-dynamic";

export const GET = auth(async (req) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const workspace = await getActiveWorkspace();
  const hideGenerated = await getHideGeneratedNotes();
  const results = await search(workspace.id, q, {
    includeGenerated: !hideGenerated,
    disabled: workspace.disabledFeatures,
  });

  return NextResponse.json({
    meetings: results.meetings.map((m) => ({
      id: m.id,
      title: m.title,
      date: formatDateInTz(m.startTime, APP_TIMEZONE),
      subtitle: `${formatDateInTz(m.startTime, APP_TIMEZONE)} · ${formatTimeInTz(m.startTime)}`,
    })),
    actions: results.actions.map((a) => ({
      id: a.id,
      content: a.content,
      meetingId: a.meetingId,
      subtitle: a.meetingTitle ?? "Standalone task",
    })),
    projects: results.projects.map((p) => ({ id: p.id, name: p.name })),
    notes: results.notes.map((n) => ({
      id: n.id,
      title: n.title || "Untitled",
    })),
  });
});
