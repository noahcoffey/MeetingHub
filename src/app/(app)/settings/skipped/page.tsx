import { listSkippedMeetings } from "@/lib/meetings";
import { getActiveWorkspaceId } from "@/lib/workspace-context";
import { formatTimeInTz, formatDateLabel, formatDateInTz, APP_TIMEZONE } from "@/lib/dates";
import { SkippedManager } from "./skipped-manager";

export const dynamic = "force-dynamic";

export default async function SkippedMeetingsPage() {
  const skipped = await listSkippedMeetings(await getActiveWorkspaceId());
  const items = skipped.map((m) => {
    const start = new Date(m.startTime);
    const day = formatDateInTz(start, APP_TIMEZONE);
    return {
      id: m.id,
      title: m.title,
      when: `${formatDateLabel(day)} · ${formatTimeInTz(start)}`,
    };
  });
  return <SkippedManager initial={items} />;
}
