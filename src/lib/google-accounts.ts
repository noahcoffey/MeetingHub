import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { googleAccounts, type GoogleAccount } from "@/db/schema";
import { decryptSecret, encryptSecret } from "./crypto";

// Safe shape for the UI — never carries the token.
export type SafeGoogleAccount = {
  id: string;
  email: string;
  createdAt: string;
};

function toSafe(a: GoogleAccount): SafeGoogleAccount {
  return { id: a.id, email: a.email, createdAt: a.createdAt.toISOString() };
}

export async function listGoogleAccounts(): Promise<SafeGoogleAccount[]> {
  const rows = await db
    .select()
    .from(googleAccounts)
    .orderBy(asc(googleAccounts.email));
  return rows.map(toSafe);
}

export async function getAccountById(
  id: string,
): Promise<GoogleAccount | undefined> {
  const [row] = await db
    .select()
    .from(googleAccounts)
    .where(eq(googleAccounts.id, id));
  return row;
}

// Insert or update (by email) a connected account, encrypting the refresh token.
export async function upsertGoogleAccount(input: {
  userId: string;
  email: string;
  refreshToken: string;
  scope?: string | null;
}): Promise<SafeGoogleAccount> {
  const enc = encryptSecret(input.refreshToken);
  const [row] = await db
    .insert(googleAccounts)
    .values({
      userId: input.userId,
      email: input.email,
      refreshTokenEnc: enc,
      scope: input.scope ?? null,
    })
    .onConflictDoUpdate({
      target: googleAccounts.email,
      set: {
        refreshTokenEnc: enc,
        scope: input.scope ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return toSafe(row);
}

// Decrypted refresh token for an account, or null if it's gone.
export async function getRefreshToken(id: string): Promise<string | null> {
  const [row] = await db
    .select({ enc: googleAccounts.refreshTokenEnc })
    .from(googleAccounts)
    .where(eq(googleAccounts.id, id));
  return row ? decryptSecret(row.enc) : null;
}

export async function deleteGoogleAccount(id: string): Promise<void> {
  // Workspaces referencing it fall back to ICS/manual (FK set null).
  await db.delete(googleAccounts).where(eq(googleAccounts.id, id));
}
