import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { saveJournalNotes, touchEntry } from "@/lib/journal";
import {
  setEntryStatValue,
  type StatValueInput,
} from "@/lib/journal-stats";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = auth(async (req, ctx) => {
  if (!req.auth) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await (ctx as unknown as Ctx).params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { notes, baseNotesUpdatedAt, stats } = (body ?? {}) as {
    notes?: unknown;
    baseNotesUpdatedAt?: unknown;
    stats?: unknown;
  };

  // Notes autosave path (with optimistic-concurrency check).
  if (typeof notes === "string") {
    const base =
      typeof baseNotesUpdatedAt === "string"
        ? new Date(baseNotesUpdatedAt)
        : null;
    const result = await saveJournalNotes(
      id,
      notes,
      base && !Number.isNaN(base.getTime()) ? base : null,
    );
    if (result === null) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!result.ok) {
      return NextResponse.json(
        {
          conflict: true,
          notes: result.notes,
          notesUpdatedAt: result.notesUpdatedAt.toISOString(),
        },
        { status: 409 },
      );
    }
    return NextResponse.json({
      ok: true,
      notesUpdatedAt: result.notesUpdatedAt.toISOString(),
    });
  }

  // Stat-values path: { stats: { [statId]: number | boolean | string | null } }.
  // A value of null (or empty string, for text) clears that stat for the day.
  if (stats && typeof stats === "object" && !Array.isArray(stats)) {
    const pairs = Object.entries(stats as Record<string, unknown>);
    if (pairs.length === 0) {
      return NextResponse.json({ error: "nothing to update" }, { status: 400 });
    }
    for (const [statId, raw] of pairs) {
      const ok = await setEntryStatValue(id, statId, raw as StatValueInput);
      if (!ok) {
        return NextResponse.json(
          { error: `invalid value for stat ${statId}` },
          { status: 400 },
        );
      }
    }
    await touchEntry(id);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "nothing to update" }, { status: 400 });
});
