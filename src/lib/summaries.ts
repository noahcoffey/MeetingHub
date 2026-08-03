import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { weeklySummaries, type WeeklySummary } from "@/db/schema";

// Everything but the markdown body — the list surface.
export type WeeklySummaryMeta = Pick<
  WeeklySummary,
  "id" | "workspaceId" | "weekStart" | "model" | "generatedAt" | "createdAt" | "updatedAt"
>;

const metaColumns = {
  id: weeklySummaries.id,
  workspaceId: weeklySummaries.workspaceId,
  weekStart: weeklySummaries.weekStart,
  model: weeklySummaries.model,
  generatedAt: weeklySummaries.generatedAt,
  createdAt: weeklySummaries.createdAt,
  updatedAt: weeklySummaries.updatedAt,
};

// Upsert on (workspaceId, weekStart). `created` distinguishes 201 vs 200 —
// checked with a select first; single-user, so no race to guard.
export async function upsertWeeklySummary(
  workspaceId: string,
  input: {
    weekStart: string;
    markdown: string;
    model?: string | null;
    generatedAt?: Date;
  },
): Promise<{ item: WeeklySummary; created: boolean }> {
  const existing = await getWeeklySummaryByWeek(workspaceId, input.weekStart);
  const generatedAt = input.generatedAt ?? new Date();
  const model = input.model ?? null;
  if (existing) {
    const [item] = await db
      .update(weeklySummaries)
      .set({ markdown: input.markdown, model, generatedAt, updatedAt: new Date() })
      .where(eq(weeklySummaries.id, existing.id))
      .returning();
    return { item, created: false };
  }
  const [item] = await db
    .insert(weeklySummaries)
    .values({
      workspaceId,
      weekStart: input.weekStart,
      markdown: input.markdown,
      model,
      generatedAt,
    })
    .returning();
  return { item, created: true };
}

export async function listWeeklySummaries(
  workspaceId: string,
): Promise<WeeklySummaryMeta[]> {
  return db
    .select(metaColumns)
    .from(weeklySummaries)
    .where(eq(weeklySummaries.workspaceId, workspaceId))
    .orderBy(desc(weeklySummaries.weekStart));
}

export async function getWeeklySummary(
  id: string,
): Promise<WeeklySummary | undefined> {
  const [row] = await db
    .select()
    .from(weeklySummaries)
    .where(eq(weeklySummaries.id, id))
    .limit(1);
  return row;
}

export async function getWeeklySummaryByWeek(
  workspaceId: string,
  weekStart: string,
): Promise<WeeklySummary | undefined> {
  const [row] = await db
    .select()
    .from(weeklySummaries)
    .where(
      and(
        eq(weeklySummaries.workspaceId, workspaceId),
        eq(weeklySummaries.weekStart, weekStart),
      ),
    )
    .limit(1);
  return row;
}
