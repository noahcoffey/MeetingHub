import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings } from "@/db/schema";

// Advanced-settings toggles (Settings → hold "A" → Advanced). All of these are
// soft hides: the underlying data keeps flowing/being stored, so flipping a
// toggle back restores everything.

async function getBool(key: string): Promise<boolean> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key));
  return row?.value === "1";
}

async function setBool(key: string, on: boolean): Promise<void> {
  const value = on ? "1" : "0";
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}

// Hide generated/Notes+ notes everywhere (meeting detail,
// past-meetings accordion, Notes+ badges, search) and the Incoming notes screen.
const HIDE_GENERATED_KEY = "hide_generated_notes";

export async function getHideGeneratedNotes(): Promise<boolean> {
  return getBool(HIDE_GENERATED_KEY);
}

export async function setHideGeneratedNotes(hidden: boolean): Promise<void> {
  return setBool(HIDE_GENERATED_KEY, hidden);
}

// NOTE: the former "hide anxiety" toggle was removed — anxiety is now just a
// user-definable journal stat that can be archived under Settings → Journal stats.

// Generic string values (non-secret ids/config — secrets belong in dedicated
// tables with encryption, e.g. google_accounts). Used by lib/drive.ts for the
// Drive account/root-folder designation.

export async function getStringSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select()
    .from(appSettings)
    .where(eq(appSettings.key, key));
  return row?.value ?? null;
}

export async function setStringSetting(
  key: string,
  value: string | null,
): Promise<void> {
  if (value === null) {
    await db.delete(appSettings).where(eq(appSettings.key, key));
    return;
  }
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updatedAt: new Date() },
    });
}
