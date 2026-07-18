import { countPendingIngests } from "@/lib/ingest";
import { getHideGeneratedNotes } from "@/lib/app-settings";
import { SettingsNav } from "./settings-nav";

export const dynamic = "force-dynamic";

export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [incomingCount, hideIncoming] = await Promise.all([
    countPendingIngests(),
    getHideGeneratedNotes(),
  ]);
  return (
    <div className="page settings-page">
      <h1 className="page-title">Settings</h1>
      <div className="settings-body">
        <SettingsNav incomingCount={incomingCount} hideIncoming={hideIncoming} />
        <div className="settings-content">{children}</div>
      </div>
    </div>
  );
}
