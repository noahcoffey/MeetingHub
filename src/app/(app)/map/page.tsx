import { redirect } from "next/navigation";
import { getWorkspaceMap } from "@/lib/project-relations";
import { getActiveWorkspace } from "@/lib/workspace-context";
import { isFeatureEnabled } from "@/lib/workspaces";
import { MapWorkspace } from "./map-workspace";

export const dynamic = "force-dynamic";

// The whole workspace graph is loaded once; everything after that — re-centring,
// connecting, editing, the detail panel — happens client-side without a
// navigation. ?focus= deep-links a starting project.
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string }>;
}) {
  const workspace = await getActiveWorkspace();
  if (!isFeatureEnabled(workspace, "projects")) redirect("/");
  const { focus } = await searchParams;

  const { nodes, edges } = await getWorkspaceMap(workspace.id);
  const focusId =
    focus && nodes.some((n) => n.id === focus) ? focus : null;

  if (nodes.length === 0) {
    return (
      <div className="page">
        <h1 className="page-title">Map</h1>
        <p className="muted empty-sm">No projects yet.</p>
      </div>
    );
  }

  return (
    <MapWorkspace
      initialNodes={nodes.map((n) => ({
        id: n.id,
        name: n.name,
        status: n.status,
        deadline: n.deadline,
        openTasks: n.openTasks,
      }))}
      initialEdges={edges}
      initialFocusId={focusId}
    />
  );
}
