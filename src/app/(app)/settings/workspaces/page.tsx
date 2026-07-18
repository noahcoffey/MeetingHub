import { listWorkspaces } from "@/lib/workspaces";
import { listGoogleAccounts } from "@/lib/google-accounts";
import { WorkspacesManager } from "./workspaces-manager";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  const [workspaces, googleAccounts] = await Promise.all([
    listWorkspaces(),
    listGoogleAccounts(),
  ]);
  return (
    <WorkspacesManager
      googleAccounts={googleAccounts.map((a) => ({ id: a.id, email: a.email }))}
      initial={workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        icsUrl: w.icsUrl,
        isDefault: w.isDefault,
        sortOrder: w.sortOrder,
        disabledFeatures: w.disabledFeatures,
        googleAccountId: w.googleAccountId,
        googleCalendarId: w.googleCalendarId,
      }))}
    />
  );
}
