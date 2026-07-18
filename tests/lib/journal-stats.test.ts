import { beforeEach, describe, expect, it } from "vitest";
import {
  createStat,
  deleteStat,
  getEntryValues,
  getValuesInRange,
  listStats,
  normalizeConfig,
  reorderStats,
  seedDefaultStats,
  setEntryStatValue,
  setStatArchived,
  updateStat,
} from "@/lib/journal-stats";
import { getOrCreateEntry } from "@/lib/journal";
import { makeWorkspace, resetDb } from "../helpers";

let ws: string;
let other: string;

beforeEach(async () => {
  await resetDb();
  ws = await makeWorkspace("Alpha", { isDefault: true });
  other = await makeWorkspace("Beta");
});

describe("seedDefaultStats", () => {
  it("creates the four defaults, ordered, idempotently", async () => {
    await seedDefaultStats(ws);
    await seedDefaultStats(ws); // no-op second time
    const stats = await listStats(ws);
    expect(stats.map((s) => s.name)).toEqual([
      "Productivity",
      "Anxiety",
      "Wins",
      "Learnings",
    ]);
    expect(stats[0].type).toBe("scale");
    expect(stats[0].direction).toBe("good");
    expect(stats[1].direction).toBe("bad");
    expect(stats[2].type).toBe("text");
    expect(stats.filter((s) => s.showOnDashboard).map((s) => s.name)).toEqual([
      "Productivity",
      "Anxiety",
    ]);
  });
});

describe("normalizeConfig", () => {
  it("falls back to a 1-5 scale when labels are missing", () => {
    expect(normalizeConfig("scale", {}).labels).toEqual(["1", "2", "3", "4", "5"]);
  });
  it("keeps provided scale labels (trimmed, capped at 10)", () => {
    expect(normalizeConfig("scale", { labels: [" Low ", "High"] }).labels).toEqual(
      ["Low", "High"],
    );
  });
  it("orders number min/max and keeps the unit", () => {
    expect(normalizeConfig("number", { min: 10, max: 1, unit: " h " })).toEqual({
      min: 1,
      max: 10,
      unit: "h",
    });
  });
});

describe("createStat + listStats", () => {
  it("creates a stat with a sequential sort order", async () => {
    const a = await createStat(ws, { name: "Sleep", type: "number" });
    const b = await createStat(ws, { name: "Mood", type: "scale" });
    expect(b.sortOrder).toBeGreaterThan(a.sortOrder);
    const names = (await listStats(ws)).map((s) => s.name);
    expect(names).toEqual(["Sleep", "Mood"]);
  });

  it("excludes archived stats unless asked", async () => {
    const a = await createStat(ws, { name: "Temp", type: "boolean" });
    await setStatArchived(a.id, true);
    expect((await listStats(ws)).length).toBe(0);
    expect((await listStats(ws, { includeArchived: true })).length).toBe(1);
  });
});

describe("setEntryStatValue", () => {
  it("clamps a scale value to its label count", async () => {
    const stat = await createStat(ws, {
      name: "Focus",
      type: "scale",
      config: { labels: ["Lo", "Mid", "Hi"] },
    });
    const entry = await getOrCreateEntry(ws, "2026-07-10");
    expect(await setEntryStatValue(entry.id, stat.id, 9)).toBe(true);
    const vals = await getEntryValues(entry.id);
    expect(vals.get(stat.id)?.numValue).toBe(3); // clamped to labels.length
  });

  it("clamps a number to its min/max", async () => {
    const stat = await createStat(ws, {
      name: "Hours",
      type: "number",
      config: { min: 0, max: 12 },
    });
    const entry = await getOrCreateEntry(ws, "2026-07-10");
    await setEntryStatValue(entry.id, stat.id, 20);
    expect((await getEntryValues(entry.id)).get(stat.id)?.numValue).toBe(12);
  });

  it("stores a boolean as 0/1 and accepts real booleans", async () => {
    const stat = await createStat(ws, { name: "Exercised", type: "boolean" });
    const entry = await getOrCreateEntry(ws, "2026-07-10");
    await setEntryStatValue(entry.id, stat.id, true);
    expect((await getEntryValues(entry.id)).get(stat.id)?.numValue).toBe(1);
  });

  it("stores text and clears on empty", async () => {
    const stat = await createStat(ws, { name: "Notes", type: "text" });
    const entry = await getOrCreateEntry(ws, "2026-07-10");
    await setEntryStatValue(entry.id, stat.id, "a good day");
    expect((await getEntryValues(entry.id)).get(stat.id)?.textValue).toBe(
      "a good day",
    );
    await setEntryStatValue(entry.id, stat.id, "");
    expect((await getEntryValues(entry.id)).has(stat.id)).toBe(false);
  });

  it("null clears a numeric value", async () => {
    const stat = await createStat(ws, { name: "Focus", type: "scale" });
    const entry = await getOrCreateEntry(ws, "2026-07-10");
    await setEntryStatValue(entry.id, stat.id, 3);
    await setEntryStatValue(entry.id, stat.id, null);
    expect((await getEntryValues(entry.id)).has(stat.id)).toBe(false);
  });

  it("rejects a stat from another workspace", async () => {
    const foreign = await createStat(other, { name: "Foreign", type: "scale" });
    const entry = await getOrCreateEntry(ws, "2026-07-10");
    expect(await setEntryStatValue(entry.id, foreign.id, 3)).toBe(false);
  });

  it("rejects an invalid value type", async () => {
    const stat = await createStat(ws, { name: "Focus", type: "scale" });
    const entry = await getOrCreateEntry(ws, "2026-07-10");
    // a string for a numeric stat is invalid
    expect(
      await setEntryStatValue(entry.id, stat.id, "nope" as unknown as number),
    ).toBe(false);
  });
});

describe("getValuesInRange", () => {
  it("returns values joined to their entry date, within the window", async () => {
    const stat = await createStat(ws, { name: "Focus", type: "scale" });
    const e1 = await getOrCreateEntry(ws, "2026-07-05");
    const e2 = await getOrCreateEntry(ws, "2026-07-20");
    await setEntryStatValue(e1.id, stat.id, 2);
    await setEntryStatValue(e2.id, stat.id, 4);
    const rows = await getValuesInRange(ws, "2026-07-01", "2026-07-10");
    expect(rows).toHaveLength(1);
    expect(rows[0].entryDate).toBe("2026-07-05");
    expect(rows[0].numValue).toBe(2);
  });
});

describe("reorder / update / delete", () => {
  it("persists a new order", async () => {
    const a = await createStat(ws, { name: "A", type: "scale" });
    const b = await createStat(ws, { name: "B", type: "scale" });
    await reorderStats(ws, [b.id, a.id]);
    expect((await listStats(ws)).map((s) => s.name)).toEqual(["B", "A"]);
  });

  it("edits name/direction/dashboard but not type", async () => {
    const a = await createStat(ws, { name: "A", type: "scale" });
    const updated = await updateStat(a.id, {
      name: "Renamed",
      direction: "bad",
      showOnDashboard: true,
    });
    expect(updated?.name).toBe("Renamed");
    expect(updated?.direction).toBe("bad");
    expect(updated?.showOnDashboard).toBe(true);
    expect(updated?.type).toBe("scale");
  });

  it("deleting a stat removes its logged values", async () => {
    const stat = await createStat(ws, { name: "Focus", type: "scale" });
    const entry = await getOrCreateEntry(ws, "2026-07-10");
    await setEntryStatValue(entry.id, stat.id, 3);
    await deleteStat(stat.id);
    expect((await getEntryValues(entry.id)).size).toBe(0);
  });
});
