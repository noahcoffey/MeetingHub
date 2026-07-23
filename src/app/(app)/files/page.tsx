import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { isFeatureEnabled } from "@/lib/workspaces";
import { FileBrowser } from "./file-browser";

export const dynamic = "force-dynamic";

export default async function FilesPage() {
  const workspace = await getActiveWorkspace();
  if (!isFeatureEnabled(workspace, "files")) redirect("/");

  return (
    <div className="page">
      <div className="day-toolbar">
        <div className="day-toolbar-id">
          <h1 className="page-title">Files</h1>
          <p className="muted page-subtitle">
            This workspace&apos;s files, stored in your Google Drive under{" "}
            <code>MeetingHub/{workspace.name}/Files</code>.
          </p>
        </div>
      </div>

      <FileBrowser />
    </div>
  );
}
