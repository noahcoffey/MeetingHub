import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { actionItems, taskDependencies, type TaskDependency } from "@/db/schema";

// Edges have no workspace column of their own — they inherit scope from their
// endpoints. Both endpoints are same-workspace (addDependency rejects mixed
// edges), so joining on the taskId side and filtering that is sufficient.
export async function listDependencyEdges(
  workspaceId: string,
): Promise<{ id: string; taskId: string; dependsOnId: string }[]> {
  return db
    .select({
      id: taskDependencies.id,
      taskId: taskDependencies.taskId,
      dependsOnId: taskDependencies.dependsOnId,
    })
    .from(taskDependencies)
    .innerJoin(actionItems, eq(taskDependencies.taskId, actionItems.id))
    .where(eq(actionItems.workspaceId, workspaceId));
}

// Can `from` reach `to` by walking existing depends-on edges forward? If so, adding
// from -> to (as taskId -> dependsOnId) would close a cycle.
function canReach(
  from: string,
  to: string,
  edges: { taskId: string; dependsOnId: string }[],
): boolean {
  const queue = [from];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift() as string;
    if (current === to) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    for (const e of edges) {
      if (e.taskId === current) queue.push(e.dependsOnId);
    }
  }
  return false;
}

export type AddDependencyResult =
  | { ok: true; edge: TaskDependency }
  | {
      ok: false;
      reason: "self" | "not-found" | "duplicate" | "cycle" | "cross-workspace";
    };

export async function addDependency(
  taskId: string,
  dependsOnId: string,
): Promise<AddDependencyResult> {
  if (taskId === dependsOnId) return { ok: false, reason: "self" };

  const found = await db
    .select({ id: actionItems.id, workspaceId: actionItems.workspaceId })
    .from(actionItems)
    .where(inArray(actionItems.id, [taskId, dependsOnId]));
  if (found.length !== 2) return { ok: false, reason: "not-found" };
  // An edge inherits its scope from its endpoints; a task may not depend on one
  // in another workspace.
  if (found[0].workspaceId !== found[1].workspaceId) {
    return { ok: false, reason: "cross-workspace" };
  }

  const edges = await db
    .select({ taskId: taskDependencies.taskId, dependsOnId: taskDependencies.dependsOnId })
    .from(taskDependencies);
  if (edges.some((e) => e.taskId === taskId && e.dependsOnId === dependsOnId)) {
    return { ok: false, reason: "duplicate" };
  }
  // Adding taskId -> dependsOnId closes a cycle iff dependsOnId can already reach taskId.
  if (canReach(dependsOnId, taskId, edges)) {
    return { ok: false, reason: "cycle" };
  }

  const [edge] = await db
    .insert(taskDependencies)
    .values({ taskId, dependsOnId })
    .returning();
  return { ok: true, edge };
}

export async function removeDependency(id: string): Promise<void> {
  await db.delete(taskDependencies).where(eq(taskDependencies.id, id));
}
