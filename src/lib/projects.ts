import "server-only";
import { and, asc, count, desc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  projects,
  meetings,
  actionItems,
  type Project,
  type NewProject,
  type Meeting,
  type ActionItem,
} from "@/db/schema";
import { tryArchiveProjectFolder, tryRenameDriveFolder } from "./drive";

export async function listProjects(
  workspaceId: string,
  opts?: {
    includeArchived?: boolean;
  },
): Promise<Project[]> {
  if (opts?.includeArchived) {
    return db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId))
      .orderBy(asc(projects.name));
  }
  return db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.status, "active")))
    .orderBy(asc(projects.name));
}

export async function getProject(id: string): Promise<Project | undefined> {
  const [p] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return p;
}

export async function createProject(
  workspaceId: string,
  input: {
    name: string;
    description?: string;
    deadline?: string | null;
  },
): Promise<Project> {
  const values: NewProject = {
    workspaceId,
    name: input.name,
    description: input.description ?? "",
    deadline: input.deadline ?? null,
  };
  const [p] = await db.insert(projects).values(values).returning();
  return p;
}

export async function updateProject(
  id: string,
  patch: {
    name?: string;
    description?: string;
    deadline?: string | null;
    status?: "active" | "archived";
  },
): Promise<Project | undefined> {
  const set: Partial<NewProject> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.deadline !== undefined) set.deadline = patch.deadline;
  if (patch.status !== undefined) {
    set.status = patch.status;
    // Track archive time, same convention as action_items.completedAt; cleared on reactivate.
    set.archivedAt = patch.status === "archived" ? new Date() : null;
  }
  const [p] = await db
    .update(projects)
    .set(set)
    .where(eq(projects.id, id))
    .returning();
  // Best-effort: keep the Drive folder's name in sync (no-op when Drive isn't
  // connected or the project has no folder yet; never fails the update).
  if (p && patch.name !== undefined) {
    await tryRenameDriveFolder(p.driveFolderId, p.name, { projectId: p.id });
  }
  return p;
}

export async function deleteProject(id: string): Promise<void> {
  const project = await getProject(id);
  // meetings.project_id / action_items.project_id are ON DELETE SET NULL —
  // this detaches associated work, never deletes it.
  await db.delete(projects).where(eq(projects.id, id));
  // Best-effort: park the Drive folder under Projects/_archived (user files
  // are never deleted; failures only warn).
  if (project) await tryArchiveProjectFolder(project);
}

export async function listMeetingsForProject(projectId: string): Promise<Meeting[]> {
  return db
    .select()
    .from(meetings)
    .where(eq(meetings.projectId, projectId))
    .orderBy(desc(meetings.startTime));
}

export async function listActionItemsForProject(
  projectId: string,
): Promise<ActionItem[]> {
  return db
    .select()
    .from(actionItems)
    .where(eq(actionItems.projectId, projectId))
    .orderBy(asc(actionItems.createdAt));
}

export type ProjectSummary = {
  id: string;
  name: string;
  deadline: string | null;
  openTaskCount: number;
  nextMeetingTitle: string | null;
  nextMeetingStart: Date | null;
};

// Active projects with an open-task count and next upcoming meeting — the /projects
// list page's data. A couple of grouped queries, not N+1.
export async function getProjectSummaries(
  workspaceId: string,
): Promise<ProjectSummary[]> {
  const active = await listProjects(workspaceId);
  if (active.length === 0) return [];

  const [openCounts, nextMeetings] = await Promise.all([
    db
      .select({ projectId: actionItems.projectId, n: count() })
      .from(actionItems)
      .where(
        and(
          eq(actionItems.workspaceId, workspaceId),
          eq(actionItems.status, "open"),
          isNotNull(actionItems.projectId),
        ),
      )
      .groupBy(actionItems.projectId),
    db
      .select({
        projectId: meetings.projectId,
        title: meetings.title,
        startTime: meetings.startTime,
      })
      .from(meetings)
      .where(
        and(
          eq(meetings.workspaceId, workspaceId),
          gte(meetings.startTime, new Date()),
          eq(meetings.skipped, false),
        ),
      )
      .orderBy(asc(meetings.startTime)),
  ]);

  const openCountByProject = new Map<string, number>();
  for (const row of openCounts) {
    if (row.projectId) openCountByProject.set(row.projectId, row.n);
  }
  const nextMeetingByProject = new Map<string, { title: string; startTime: Date }>();
  for (const row of nextMeetings) {
    if (row.projectId && !nextMeetingByProject.has(row.projectId)) {
      nextMeetingByProject.set(row.projectId, { title: row.title, startTime: row.startTime });
    }
  }

  return active.map((p) => {
    const next = nextMeetingByProject.get(p.id);
    return {
      id: p.id,
      name: p.name,
      deadline: p.deadline,
      openTaskCount: openCountByProject.get(p.id) ?? 0,
      nextMeetingTitle: next?.title ?? null,
      nextMeetingStart: next?.startTime ?? null,
    };
  });
}

export type UntaggedMeeting = { id: string; title: string; startTime: Date };
export type UntaggedActionItem = {
  id: string;
  content: string;
  meetingId: string | null;
  createdAt: Date;
};

// Recent meetings/action items with no project — the triage-view data source.
// Dismissed rows ("doesn't need a project") stay out permanently.
export async function listUntagged(
  workspaceId: string,
  opts?: {
    limit?: number;
  },
): Promise<{ meetings: UntaggedMeeting[]; actionItems: UntaggedActionItem[] }> {
  const limit = opts?.limit ?? 20;
  const [untaggedMeetings, untaggedActionItems] = await Promise.all([
    db
      .select({ id: meetings.id, title: meetings.title, startTime: meetings.startTime })
      .from(meetings)
      .where(
        and(
          eq(meetings.workspaceId, workspaceId),
          isNull(meetings.projectId),
          isNull(meetings.untaggedDismissedAt),
        ),
      )
      .orderBy(desc(meetings.startTime))
      .limit(limit),
    db
      .select({
        id: actionItems.id,
        content: actionItems.content,
        meetingId: actionItems.meetingId,
        createdAt: actionItems.createdAt,
      })
      .from(actionItems)
      .where(
        and(
          eq(actionItems.workspaceId, workspaceId),
          isNull(actionItems.projectId),
          eq(actionItems.status, "open"),
          isNull(actionItems.untaggedDismissedAt),
        ),
      )
      .orderBy(desc(actionItems.createdAt))
      .limit(limit),
  ]);
  return { meetings: untaggedMeetings, actionItems: untaggedActionItems };
}

// Fuzzy name match against active projects — a pre-fill suggestion, not a guarantee.
// Different direction of match than src/lib/search.ts (which answers "what matches
// what the user typed"): this answers "what project does this text probably belong to."
export async function suggestProjectFor(
  workspaceId: string,
  text: string,
): Promise<{ id: string; name: string } | null> {
  const q = text.trim();
  if (q.length < 3) return null;
  const [row] = (await db.execute(sql`
    SELECT id, name
    FROM projects
    WHERE status = 'active'
      AND workspace_id = ${workspaceId}
      AND similarity(name, ${q}) > 0.35
    ORDER BY similarity(name, ${q}) DESC
    LIMIT 1
  `)) as unknown as Array<{ id: string; name: string }>;
  return row ?? null;
}
