import { redirect } from "next/navigation";
import { INGEST_LOG_LIMIT, listIngestEvents } from "@/lib/ingest";
import { getHideGeneratedNotes } from "@/lib/app-settings";
import { listWorkspaces } from "@/lib/workspaces";
import { getActiveWorkspaceId } from "@/lib/workspace-context";
import {
  APP_TIMEZONE,
  formatDateInTz,
  formatDateLabel,
  formatTimeInTz,
  todayInAppTz,
} from "@/lib/dates";
import { IngestLogManager, type IngestLogItem } from "./ingest-log-manager";

export const dynamic = "force-dynamic";

function when(d: Date | null): string | null {
  if (!d) return null;
  return `${formatDateLabel(formatDateInTz(d, APP_TIMEZONE))} · ${formatTimeInTz(d)}`;
}

export default async function IngestLogPage() {
  // Same gate as Incoming: the Advanced toggle hides everything generated-notes.
  if (await getHideGeneratedNotes()) redirect("/settings/hidden");
  const [events, workspaces, activeWorkspaceId] = await Promise.all([
    listIngestEvents(),
    listWorkspaces(),
    getActiveWorkspaceId(),
  ]);

  const items: IngestLogItem[] = events.map((e) => {
    const start = e.startTime ? new Date(e.startTime) : null;
    return {
      id: e.id,
      receivedAt: when(new Date(e.createdAt)) ?? "",
      sourceId: e.sourceId,
      title: e.title,
      when: when(start),
      defaultDate: formatDateInTz(
        start ?? (e.meeting ? new Date(e.meeting.startTime) : new Date(e.createdAt)),
        APP_TIMEZONE,
      ) || todayInAppTz(),
      workspaceLabel:
        e.workspaceName ??
        (e.workspaceHint ? `${e.workspaceHint} (no such workspace)` : null),
      outcome: e.outcome,
      reassigned: !!e.reassignedAt,
      stillPending: e.stillPending,
      meeting: e.meeting
        ? {
            id: e.meeting.id,
            title: e.meeting.title,
            when: when(new Date(e.meeting.startTime)) ?? "",
            skipped: e.meeting.skipped,
            hidden: e.meeting.hidden,
            workspaceId: e.meeting.workspaceId,
            workspaceName: e.meeting.workspaceName,
            holdsBody: e.meeting.holdsBody,
            hasGenerated: e.meeting.hasGenerated,
          }
        : null,
      matchedMeeting: e.matchedMeeting
        ? { id: e.matchedMeeting.id, title: e.matchedMeeting.title }
        : null,
      preview:
        e.notesGenerated.length > 280
          ? `${e.notesGenerated.slice(0, 280)}…`
          : e.notesGenerated,
    };
  });

  return (
    <IngestLogManager
      initial={items}
      limit={INGEST_LOG_LIMIT}
      workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
      activeWorkspaceId={activeWorkspaceId}
    />
  );
}
