import { redirect } from "next/navigation";
import { listPendingIngests } from "@/lib/ingest";
import { getHideGeneratedNotes } from "@/lib/app-settings";
import {
  formatDateLabel,
  formatTimeInTz,
  formatDateInTz,
  todayInAppTz,
  APP_TIMEZONE,
} from "@/lib/dates";
import { IncomingManager, type IncomingItem } from "./incoming-manager";

export const dynamic = "force-dynamic";

export default async function IncomingNotesPage() {
  // Hidden completely by the Advanced "hide generated notes" toggle — the nav
  // item is gone, and the direct URL bounces too.
  if (await getHideGeneratedNotes()) redirect("/settings/hidden");
  const pending = await listPendingIngests();
  const items: IncomingItem[] = pending.map((p) => {
    const start = p.startTime ? new Date(p.startTime) : null;
    return {
      id: p.id,
      title: p.title,
      when: start
        ? `${formatDateLabel(formatDateInTz(start, APP_TIMEZONE))} · ${formatTimeInTz(start)}`
        : "No date provided",
      defaultDate: start ? formatDateInTz(start, APP_TIMEZONE) : todayInAppTz(),
      preview:
        p.notesGenerated.length > 280
          ? `${p.notesGenerated.slice(0, 280)}…`
          : p.notesGenerated,
      workspaceId: p.workspaceId,
      // Resolved tag shows the workspace name; an unresolved hint is still
      // shown so it's obvious where the push meant it to go.
      workspaceLabel:
        p.workspaceName ??
        (p.workspaceHint ? `${p.workspaceHint} (no such workspace)` : null),
    };
  });

  return <IncomingManager initial={items} />;
}
