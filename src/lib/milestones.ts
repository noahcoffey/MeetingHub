import "server-only";
import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  actionItems,
  projectMilestones,
  projects,
  type ProjectMilestone,
} from "@/db/schema";

export type MilestoneWithProgress = ProjectMilestone & {
  // Progress counts ALL linked tasks (open + done), ignoring snooze/scheduled
  // visibility — the bar measures work, not what's currently shown.
  totalTaskCount: number;
  doneTaskCount: number;
};

// Date-driven ordering: dated milestones chronologically, undated ("someday")
// last, creation order as the tiebreak.
const milestoneOrder = [
  sql`${projectMilestones.dueDate} asc nulls last`,
  asc(projectMilestones.createdAt),
];

export async function listMilestonesForProject(
  projectId: string,
): Promise<MilestoneWithProgress[]> {
  const rows = await db
    .select()
    .from(projectMilestones)
    .where(eq(projectMilestones.projectId, projectId))
    .orderBy(...milestoneOrder);
  if (rows.length === 0) return [];

  const counts = await db
    .select({
      milestoneId: actionItems.milestoneId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(*) filter (where ${actionItems.status} = 'done')::int`,
    })
    .from(actionItems)
    .where(
      inArray(
        actionItems.milestoneId,
        rows.map((m) => m.id),
      ),
    )
    .groupBy(actionItems.milestoneId);
  const byId = new Map(counts.map((c) => [c.milestoneId, c]));

  return rows.map((m) => ({
    ...m,
    totalTaskCount: byId.get(m.id)?.total ?? 0,
    doneTaskCount: byId.get(m.id)?.done ?? 0,
  }));
}

export async function getMilestone(
  id: string,
): Promise<ProjectMilestone | undefined> {
  const [m] = await db
    .select()
    .from(projectMilestones)
    .where(eq(projectMilestones.id, id))
    .limit(1);
  return m;
}

export async function createMilestone(input: {
  projectId: string;
  name: string;
  dueDate?: string | null;
}): Promise<ProjectMilestone> {
  const [m] = await db
    .insert(projectMilestones)
    .values({
      projectId: input.projectId,
      name: input.name,
      dueDate: input.dueDate ?? null,
    })
    .returning();
  return m;
}

export async function updateMilestone(
  id: string,
  patch: { name?: string; dueDate?: string | null; completed?: boolean },
): Promise<ProjectMilestone | undefined> {
  const set: Partial<typeof projectMilestones.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  // Manual completion, mirroring projects.archivedAt semantics.
  if (patch.completed !== undefined) {
    set.completedAt = patch.completed ? new Date() : null;
  }
  const [m] = await db
    .update(projectMilestones)
    .set(set)
    .where(eq(projectMilestones.id, id))
    .returning();
  return m;
}

// Linked tasks detach via the set-null FK — history survives.
export async function deleteMilestone(id: string): Promise<void> {
  await db.delete(projectMilestones).where(eq(projectMilestones.id, id));
}

export type OpenDatedMilestone = {
  id: string;
  projectId: string;
  name: string;
  dueDate: string;
};

// The one workspace-level query behind the runway markers, the table's
// "next milestone" column, and the dashboard checkpoint: every open, dated
// milestone of the workspace's ACTIVE projects, soonest first (overdue
// included — it sorts first, which is the point). Workspace scoping happens
// through the projects join since milestones carry no workspace_id.
export async function listOpenDatedMilestones(
  workspaceId: string,
): Promise<OpenDatedMilestone[]> {
  const rows = await db
    .select({
      id: projectMilestones.id,
      projectId: projectMilestones.projectId,
      name: projectMilestones.name,
      dueDate: projectMilestones.dueDate,
    })
    .from(projectMilestones)
    .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
    .where(
      and(
        eq(projects.workspaceId, workspaceId),
        eq(projects.status, "active"),
        isNull(projectMilestones.completedAt),
        isNotNull(projectMilestones.dueDate),
      ),
    )
    .orderBy(asc(projectMilestones.dueDate), asc(projectMilestones.createdAt));
  // dueDate is non-null by the filter; narrow the type.
  return rows.filter((r): r is OpenDatedMilestone => r.dueDate !== null);
}
