import { listHiddenTitles } from "@/lib/meetings";
import { getActiveWorkspaceId } from "@/lib/workspace-context";
import { HiddenTitlesManager } from "./hidden-manager";

export const dynamic = "force-dynamic";

export default async function HiddenMeetingsPage() {
  const titles = await listHiddenTitles(await getActiveWorkspaceId());
  return (
    <HiddenTitlesManager
      initial={titles.map((t) => ({ id: t.id, title: t.title }))}
    />
  );
}
