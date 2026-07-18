import "server-only";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { seedDefaultStats } from "@/lib/journal-stats";
import {
  actionItems,
  hiddenMeetingTitles,
  journalEntries,
  meetings,
  notes,
  people,
  projects,
  workspaces,
  type Workspace,
  type WorkspaceFeature,
} from "@/db/schema";

// Features are stored as the disabled set; absent = on.
export function isFeatureEnabled(
  workspace: Workspace,
  feature: WorkspaceFeature,
): boolean {
  return !workspace.disabledFeatures.includes(feature);
}

export async function listWorkspaces(): Promise<Workspace[]> {
  return db
    .select()
    .from(workspaces)
    .orderBy(asc(workspaces.sortOrder), asc(workspaces.createdAt));
}

export async function getWorkspaceById(
  id: string,
): Promise<Workspace | undefined> {
  const [w] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return w;
}

// The seeded fallback workspace (migration 0022 guarantees exactly one).
export async function getDefaultWorkspace(): Promise<Workspace> {
  const [w] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.isDefault, true))
    .limit(1);
  return w;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${workspaces.sortOrder}), 0)` })
    .from(workspaces);
  const [w] = await db
    .insert(workspaces)
    .values({ name, sortOrder: max + 1 })
    .returning();
  // Every workspace starts with the default journal stats.
  await seedDefaultStats(w.id);
  return w;
}

export async function updateWorkspace(
  id: string,
  input: {
    name?: string;
    icsUrl?: string | null;
    sortOrder?: number;
    disabledFeatures?: WorkspaceFeature[];
    googleAccountId?: string | null;
    googleCalendarId?: string | null;
  },
): Promise<Workspace | undefined> {
  const [w] = await db
    .update(workspaces)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning();
  return w;
}

// What still lives in a workspace — shown in the delete guard so it's clear
// why deletion is blocked (and what would have to move first).
export type WorkspaceContentCounts = {
  meetings: number;
  actionItems: number;
  projects: number;
  people: number;
  notes: number;
  journalEntries: number;
  hiddenTitles: number;
  total: number;
};

export async function workspaceContentCounts(
  id: string,
): Promise<WorkspaceContentCounts> {
  const [[m], [a], [pr], [pe], [n], [j], [h]] = await Promise.all([
    db.select({ n: sql<number>`count(*)::int` }).from(meetings).where(eq(meetings.workspaceId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(actionItems).where(eq(actionItems.workspaceId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(projects).where(eq(projects.workspaceId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(people).where(eq(people.workspaceId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(notes).where(eq(notes.workspaceId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(journalEntries).where(eq(journalEntries.workspaceId, id)),
    db.select({ n: sql<number>`count(*)::int` }).from(hiddenMeetingTitles).where(eq(hiddenMeetingTitles.workspaceId, id)),
  ]);
  const counts = {
    meetings: m.n,
    actionItems: a.n,
    projects: pr.n,
    people: pe.n,
    notes: n.n,
    journalEntries: j.n,
    hiddenTitles: h.n,
  };
  return {
    ...counts,
    total: Object.values(counts).reduce((sum, c) => sum + c, 0),
  };
}

export type DeleteWorkspaceResult =
  | { ok: true }
  | { ok: false; reason: "default" | "not-found" }
  | { ok: false; reason: "not-empty"; counts: WorkspaceContentCounts };

// Guarded: only an empty, non-default workspace can go. The restrict FKs are
// the backstop if this guard is ever bypassed.
export async function deleteWorkspace(
  id: string,
): Promise<DeleteWorkspaceResult> {
  const w = await getWorkspaceById(id);
  if (!w) return { ok: false, reason: "not-found" };
  if (w.isDefault) return { ok: false, reason: "default" };
  const counts = await workspaceContentCounts(id);
  if (counts.total > 0) return { ok: false, reason: "not-empty", counts };
  await db.delete(workspaces).where(eq(workspaces.id, id));
  return { ok: true };
}
