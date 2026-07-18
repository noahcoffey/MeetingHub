import { auth } from "@/auth";
import { getTaskCounts } from "@/lib/action-items";
import { countPendingIngests } from "@/lib/ingest";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { listWorkspaces } from "@/lib/workspaces";
import { LogoutButton } from "../logout-button";
import { SideNav } from "./side-nav";
import { ChromeProvider, SidebarToggle } from "./chrome";
import { CommandPalette, SearchTrigger } from "./command-palette";
import { ThemeToggle } from "./theme-toggle";
import { SettingsLink } from "./settings-link";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { WorkspaceSwitcher } from "./workspace-switcher";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const initial = email.charAt(0).toUpperCase() || "?";
  const activeWorkspace = await getActiveWorkspace();
  const workspaceId = activeWorkspace.id;
  const [counts, incomingCount, workspaces] = await Promise.all([
    getTaskCounts(workspaceId),
    countPendingIngests(),
    listWorkspaces(),
  ]);

  return (
    <ChromeProvider>
      <aside className="app-sidebar">
        <div className="brand">
          <WorkspaceSwitcher
            workspaces={workspaces.map((w) => ({ id: w.id, name: w.name }))}
            activeId={workspaceId}
          />
          <SidebarToggle />
        </div>
        <SearchTrigger />
        <SideNav
          taskOpen={counts.open}
          taskDueToday={counts.dueToday}
          disabledFeatures={activeWorkspace.disabledFeatures}
        />
        <div className="sidebar-foot">
          <ThemeToggle />
          <SettingsLink count={incomingCount} />
          <div className="user-chip" title={email}>
            <span className="user-avatar">{initial}</span>
            <span className="user-email">{email}</span>
          </div>
          <LogoutButton />
        </div>
      </aside>
      <main className="app-main">{children}</main>
      <CommandPalette
        workspaceName={workspaces.find((w) => w.id === workspaceId)?.name}
      />
      <KeyboardShortcuts />
    </ChromeProvider>
  );
}
