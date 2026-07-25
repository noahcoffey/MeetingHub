import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { projectLinks, type ProjectLink } from "@/db/schema";

export async function listLinksForProject(projectId: string): Promise<ProjectLink[]> {
  return db
    .select()
    .from(projectLinks)
    .where(eq(projectLinks.projectId, projectId))
    .orderBy(asc(projectLinks.createdAt));
}

// Links placed in one Drive folder of the project's tree. Null = the
// project's top level (folderless links, incl. everything created before the
// unified browser existed).
export async function listLinksInFolder(
  projectId: string,
  driveFolderId: string | null,
): Promise<ProjectLink[]> {
  return db
    .select()
    .from(projectLinks)
    .where(
      and(
        eq(projectLinks.projectId, projectId),
        driveFolderId === null
          ? isNull(projectLinks.driveFolderId)
          : eq(projectLinks.driveFolderId, driveFolderId),
      ),
    )
    .orderBy(asc(projectLinks.createdAt));
}

export async function createLink(input: {
  projectId: string;
  url: string;
  label?: string | null;
  driveFolderId?: string | null;
}): Promise<ProjectLink> {
  const [link] = await db
    .insert(projectLinks)
    .values({
      projectId: input.projectId,
      url: input.url,
      label: input.label?.trim() || null,
      driveFolderId: input.driveFolderId ?? null,
    })
    .returning();
  return link;
}

export async function deleteLink(id: string): Promise<void> {
  await db.delete(projectLinks).where(eq(projectLinks.id, id));
}

// Drop dead folder placements: links pointing at any of these folder ids fall
// back to the project's top level. Used when the app trashes a folder (and
// its subtree) and by the base-listing self-heal for folders that vanished
// out-of-band in Drive.
export async function rehomeLinksFromFolders(
  folderIds: string[],
): Promise<void> {
  if (folderIds.length === 0) return;
  await db
    .update(projectLinks)
    .set({ driveFolderId: null })
    .where(inArray(projectLinks.driveFolderId, folderIds));
}

// Distinct folder ids currently referenced by a project's links (for the
// self-heal alive check).
export async function linkFolderIdsForProject(
  projectId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ folderId: projectLinks.driveFolderId })
    .from(projectLinks)
    .where(eq(projectLinks.projectId, projectId));
  return rows
    .map((r) => r.folderId)
    .filter((id): id is string => id !== null);
}
