import { getHideGeneratedNotes } from "@/lib/app-settings";
import { AdvancedManager } from "./advanced-manager";

export const dynamic = "force-dynamic";

// Hidden settings screen — its nav item only shows while "A" is held
// (see settings-nav.tsx), but the page itself is reachable by URL.
export default async function AdvancedSettingsPage() {
  const hideGenerated = await getHideGeneratedNotes();
  return <AdvancedManager initialHideGenerated={hideGenerated} />;
}
