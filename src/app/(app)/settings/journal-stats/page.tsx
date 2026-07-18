import { listStats } from "@/lib/journal-stats";
import { getActiveWorkspaceId } from "@/lib/workspace-context";
import { JournalStatsManager } from "./journal-stats-manager";

export const dynamic = "force-dynamic";

export default async function JournalStatsPage() {
  const workspaceId = await getActiveWorkspaceId();
  const stats = await listStats(workspaceId, { includeArchived: true });
  return (
    <JournalStatsManager
      initial={stats.map((s) => ({
        id: s.id,
        name: s.name,
        type: s.type,
        direction: s.direction,
        config: s.config,
        showOnDashboard: s.showOnDashboard,
        archived: s.archivedAt != null,
        sortOrder: s.sortOrder,
      }))}
    />
  );
}
