import "server-only";
import { and, asc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  journalEntries,
  journalStats,
  journalStatValues,
  type JournalStat,
  type JournalStatConfig,
} from "@/db/schema";

export type StatType = "scale" | "number" | "boolean" | "text";
export type StatDirection = "good" | "bad" | "neutral";

// Numeric types render on charts/dashboard; text is reflection-only.
export const NUMERIC_TYPES: StatType[] = ["scale", "number", "boolean"];
export function isNumericType(t: StatType): boolean {
  return NUMERIC_TYPES.includes(t);
}

// The default stat set every workspace starts with. Kept in sync with the seed
// in migration 0030 (that migration handles existing workspaces; this handles
// workspaces created afterwards, via createWorkspace).
export const DEFAULT_STATS: Array<{
  name: string;
  type: StatType;
  direction: StatDirection;
  config: JournalStatConfig;
  showOnDashboard: boolean;
}> = [
  {
    name: "Productivity",
    type: "scale",
    direction: "good",
    config: { labels: ["Very low", "Low", "Moderate", "High", "Very high"] },
    showOnDashboard: true,
  },
  {
    name: "Anxiety",
    type: "scale",
    direction: "bad",
    config: { labels: ["Calm", "Mild", "Moderate", "High", "Severe"] },
    showOnDashboard: true,
  },
  {
    name: "Wins",
    type: "text",
    direction: "neutral",
    config: { placeholder: "What did you achieve today?" },
    showOnDashboard: false,
  },
  {
    name: "Learnings",
    type: "text",
    direction: "neutral",
    config: { placeholder: "What did you learn today?" },
    showOnDashboard: false,
  },
];

// Seed the defaults for a brand-new workspace (no-op if it already has stats).
export async function seedDefaultStats(workspaceId: string): Promise<void> {
  const existing = await db
    .select({ id: journalStats.id })
    .from(journalStats)
    .where(eq(journalStats.workspaceId, workspaceId))
    .limit(1);
  if (existing.length > 0) return;
  await db.insert(journalStats).values(
    DEFAULT_STATS.map((s, i) => ({
      workspaceId,
      name: s.name,
      type: s.type,
      direction: s.direction,
      config: s.config,
      showOnDashboard: s.showOnDashboard,
      sortOrder: i,
    })),
  );
}

export async function listStats(
  workspaceId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<JournalStat[]> {
  const where = opts.includeArchived
    ? eq(journalStats.workspaceId, workspaceId)
    : and(
        eq(journalStats.workspaceId, workspaceId),
        isNull(journalStats.archivedAt),
      );
  return db
    .select()
    .from(journalStats)
    .where(where)
    .orderBy(asc(journalStats.sortOrder), asc(journalStats.createdAt));
}

export async function getStatById(
  id: string,
): Promise<JournalStat | undefined> {
  const [row] = await db
    .select()
    .from(journalStats)
    .where(eq(journalStats.id, id));
  return row;
}

// ---- config normalization / validation ----

// Coerce arbitrary input into a valid config for the given type.
export function normalizeConfig(
  type: StatType,
  raw: unknown,
): JournalStatConfig {
  const c = (raw && typeof raw === "object" ? raw : {}) as JournalStatConfig;
  if (type === "scale") {
    const labels = Array.isArray(c.labels)
      ? c.labels.map((l) => String(l).trim()).filter(Boolean)
      : [];
    // Fall back to a plain 1-5 scale if labels are missing/too short.
    return {
      labels:
        labels.length >= 2 ? labels.slice(0, 10) : ["1", "2", "3", "4", "5"],
    };
  }
  if (type === "number") {
    const out: JournalStatConfig = {};
    if (typeof c.min === "number" && Number.isFinite(c.min)) out.min = c.min;
    if (typeof c.max === "number" && Number.isFinite(c.max)) out.max = c.max;
    if (typeof c.unit === "string" && c.unit.trim())
      out.unit = c.unit.trim().slice(0, 16);
    if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
      const t = out.min;
      out.min = out.max;
      out.max = t;
    }
    return out;
  }
  if (type === "text") {
    return typeof c.placeholder === "string" && c.placeholder.trim()
      ? { placeholder: c.placeholder.trim().slice(0, 120) }
      : {};
  }
  return {}; // boolean
}

export type CreateStatInput = {
  name: string;
  type: StatType;
  direction?: StatDirection;
  config?: unknown;
  showOnDashboard?: boolean;
};

export async function createStat(
  workspaceId: string,
  input: CreateStatInput,
): Promise<JournalStat> {
  const [{ max }] = await db
    .select({ max: sql<number>`coalesce(max(${journalStats.sortOrder}), -1)` })
    .from(journalStats)
    .where(eq(journalStats.workspaceId, workspaceId));
  const [row] = await db
    .insert(journalStats)
    .values({
      workspaceId,
      name: input.name.trim(),
      type: input.type,
      direction: input.direction ?? "neutral",
      config: normalizeConfig(input.type, input.config),
      showOnDashboard: input.showOnDashboard ?? false,
      sortOrder: (max ?? -1) + 1,
    })
    .returning();
  return row;
}

export type UpdateStatPatch = {
  name?: string;
  direction?: StatDirection;
  config?: unknown;
  showOnDashboard?: boolean;
};

// Type is immutable after creation (existing values are typed); name/labels/
// direction/dashboard are editable.
export async function updateStat(
  id: string,
  patch: UpdateStatPatch,
): Promise<JournalStat | undefined> {
  const current = await getStatById(id);
  if (!current) return undefined;
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.direction !== undefined) set.direction = patch.direction;
  if (patch.showOnDashboard !== undefined)
    set.showOnDashboard = patch.showOnDashboard;
  if (patch.config !== undefined)
    set.config = normalizeConfig(current.type as StatType, patch.config);
  const [row] = await db
    .update(journalStats)
    .set(set)
    .where(eq(journalStats.id, id))
    .returning();
  return row;
}

// Archive (soft): keep historical values but drop from the panel/dashboard.
export async function setStatArchived(
  id: string,
  archived: boolean,
): Promise<JournalStat | undefined> {
  const [row] = await db
    .update(journalStats)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(journalStats.id, id))
    .returning();
  return row;
}

// Hard delete: also removes all logged values (FK cascade).
export async function deleteStat(id: string): Promise<void> {
  await db.delete(journalStats).where(eq(journalStats.id, id));
}

// Persist a new ordering for a workspace's stats.
export async function reorderStats(
  workspaceId: string,
  orderedIds: string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(journalStats)
        .set({ sortOrder: i, updatedAt: new Date() })
        .where(
          and(
            eq(journalStats.id, orderedIds[i]),
            eq(journalStats.workspaceId, workspaceId),
          ),
        );
    }
  });
}

// ---- values ----

export type StatValueInput = number | boolean | string | null;

// Clamp/validate a raw value for a stat's type. Returns the columns to store, or
// "clear" to delete the row, or "invalid".
function coerceValue(
  stat: JournalStat,
  raw: StatValueInput,
): { numValue: number | null; textValue: string | null } | "clear" | "invalid" {
  const type = stat.type as StatType;
  if (type === "text") {
    if (raw === null) return "clear";
    if (typeof raw !== "string") return "invalid";
    const t = raw.trim();
    return t === "" ? "clear" : { numValue: null, textValue: raw };
  }
  // numeric types
  if (raw === null) return "clear";
  if (type === "boolean") {
    if (typeof raw === "boolean")
      return { numValue: raw ? 1 : 0, textValue: null };
    if (raw === 0 || raw === 1) return { numValue: raw, textValue: null };
    return "invalid";
  }
  if (typeof raw !== "number" || !Number.isFinite(raw)) return "invalid";
  if (type === "scale") {
    const size = stat.config.labels?.length ?? 5;
    const v = Math.max(1, Math.min(size, Math.round(raw)));
    return { numValue: v, textValue: null };
  }
  // number
  let v = raw;
  const { min, max } = stat.config;
  if (typeof min === "number") v = Math.max(min, v);
  if (typeof max === "number") v = Math.min(max, v);
  return { numValue: v, textValue: null };
}

// Set (or clear) one stat's value on an entry. Rejects a stat that doesn't
// belong to the entry's workspace. Returns false on validation failure.
export async function setEntryStatValue(
  entryId: string,
  statId: string,
  raw: StatValueInput,
): Promise<boolean> {
  const [entry] = await db
    .select({ workspaceId: journalEntries.workspaceId })
    .from(journalEntries)
    .where(eq(journalEntries.id, entryId));
  if (!entry) return false;
  const stat = await getStatById(statId);
  if (!stat || stat.workspaceId !== entry.workspaceId) return false;

  const coerced = coerceValue(stat, raw);
  if (coerced === "invalid") return false;
  if (coerced === "clear") {
    await db
      .delete(journalStatValues)
      .where(
        and(
          eq(journalStatValues.journalEntryId, entryId),
          eq(journalStatValues.statId, statId),
        ),
      );
    return true;
  }
  await db
    .insert(journalStatValues)
    .values({
      journalEntryId: entryId,
      statId,
      numValue: coerced.numValue,
      textValue: coerced.textValue,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [journalStatValues.journalEntryId, journalStatValues.statId],
      set: {
        numValue: coerced.numValue,
        textValue: coerced.textValue,
        updatedAt: new Date(),
      },
    });
  return true;
}

export type StatValueRow = {
  statId: string;
  numValue: number | null;
  textValue: string | null;
};

// All logged values for one entry, keyed by statId.
export async function getEntryValues(
  entryId: string,
): Promise<Map<string, StatValueRow>> {
  const rows = await db
    .select({
      statId: journalStatValues.statId,
      numValue: journalStatValues.numValue,
      textValue: journalStatValues.textValue,
    })
    .from(journalStatValues)
    .where(eq(journalStatValues.journalEntryId, entryId));
  return new Map(rows.map((r) => [r.statId, r]));
}

// Values across a date range, for reports/dashboard. Returns rows joined to the
// entry date so callers can build per-day series.
export type DatedStatValue = {
  entryDate: string;
  statId: string;
  numValue: number | null;
  textValue: string | null;
};

export async function getValuesInRange(
  workspaceId: string,
  startDate: string,
  endDate: string,
): Promise<DatedStatValue[]> {
  return db
    .select({
      entryDate: journalEntries.entryDate,
      statId: journalStatValues.statId,
      numValue: journalStatValues.numValue,
      textValue: journalStatValues.textValue,
    })
    .from(journalStatValues)
    .innerJoin(
      journalEntries,
      eq(journalStatValues.journalEntryId, journalEntries.id),
    )
    .where(
      and(
        eq(journalEntries.workspaceId, workspaceId),
        gte(journalEntries.entryDate, startDate),
        lte(journalEntries.entryDate, endDate),
      ),
    )
    .orderBy(asc(journalEntries.entryDate));
}

// The numeric min/max a stat's chart should span.
export function statRange(stat: JournalStat): { min: number; max: number } {
  const type = stat.type as StatType;
  if (type === "boolean") return { min: 0, max: 1 };
  if (type === "scale") return { min: 1, max: stat.config.labels?.length ?? 5 };
  return {
    min: typeof stat.config.min === "number" ? stat.config.min : 0,
    max: typeof stat.config.max === "number" ? stat.config.max : 10,
  };
}
