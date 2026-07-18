import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectLinks, type ProjectLink } from "@/db/schema";

export async function listLinksForProject(projectId: string): Promise<ProjectLink[]> {
  return db
    .select()
    .from(projectLinks)
    .where(eq(projectLinks.projectId, projectId))
    .orderBy(asc(projectLinks.createdAt));
}

export async function createLink(input: {
  projectId: string;
  url: string;
  label?: string | null;
}): Promise<ProjectLink> {
  const [link] = await db
    .insert(projectLinks)
    .values({
      projectId: input.projectId,
      url: input.url,
      label: input.label?.trim() || null,
    })
    .returning();
  return link;
}

export async function deleteLink(id: string): Promise<void> {
  await db.delete(projectLinks).where(eq(projectLinks.id, id));
}
