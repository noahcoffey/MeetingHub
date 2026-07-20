import "server-only";
import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  users,
  webauthnCredentials,
  recoveryCodes,
  type User,
  type WebauthnCredential,
} from "@/db/schema";

export const REG_CHALLENGE_COOKIE = "mh-reg-challenge";
export const AUTH_CHALLENGE_COOKIE = "mh-auth-challenge";

// Relying-party id (domain, no port) + full origin, derived from the request so it
// works across localhost and the deployed domain without extra config.
// Structural param ({ headers }) rather than Request: mcp-handler globally
// augments Request with an `auth` field that conflicts with NextAuthRequest,
// so typing these against Request would reject next-auth wrapped handlers.
export function rpInfo(request: { headers: Headers }): {
  rpID: string;
  origin: string;
} {
  const host = request.headers.get("host") ?? "localhost:3000";
  const proto =
    request.headers.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return { rpID: host.split(":")[0], origin: `${proto}://${host}` };
}

// Read a cookie from a raw Request (used in the Credentials authorize()).
export function readCookie(
  request: { headers: Headers },
  name: string,
): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

// ---- user ----
export async function getSingleUser(): Promise<User | undefined> {
  const [u] = await db.select().from(users).limit(1);
  return u;
}
export async function getUserById(id: string): Promise<User | undefined> {
  const [u] = await db.select().from(users).where(eq(users.id, id));
  return u;
}
export async function setPasswordEnabled(userId: string, enabled: boolean) {
  await db
    .update(users)
    .set({ passwordEnabled: enabled })
    .where(eq(users.id, userId));
}

// ---- credentials ----
export async function listCredentials(
  userId: string,
): Promise<WebauthnCredential[]> {
  return db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId))
    .orderBy(asc(webauthnCredentials.createdAt));
}
export async function countCredentials(userId: string): Promise<number> {
  return (await listCredentials(userId)).length;
}
export async function getCredential(
  credentialId: string,
): Promise<WebauthnCredential | undefined> {
  const [c] = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.credentialId, credentialId));
  return c;
}
export async function insertCredential(v: {
  userId: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  name: string;
}) {
  await db.insert(webauthnCredentials).values(v);
}
export async function updateCredentialCounter(
  credentialId: string,
  counter: number,
) {
  await db
    .update(webauthnCredentials)
    .set({ counter, lastUsedAt: new Date() })
    .where(eq(webauthnCredentials.credentialId, credentialId));
}
export async function deleteCredential(id: string, userId: string) {
  await db
    .delete(webauthnCredentials)
    .where(
      and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, userId)),
    );
}
export async function renameCredential(
  id: string,
  userId: string,
  name: string,
) {
  await db
    .update(webauthnCredentials)
    .set({ name })
    .where(
      and(eq(webauthnCredentials.id, id), eq(webauthnCredentials.userId, userId)),
    );
}

// ---- recovery codes ----
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I,O,0,1

function normalizeCode(raw: string): string {
  const s = raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  return s.length === 10 ? `${s.slice(0, 5)}-${s.slice(5)}` : s;
}

function randomCode(): string {
  const b = randomBytes(10);
  let s = "";
  for (let i = 0; i < 10; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

// Replaces any existing codes; returns the plaintext codes to show ONCE.
export async function generateRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: 10 }, randomCode);
  const rows = await Promise.all(
    codes.map(async (c) => ({ userId, codeHash: await bcrypt.hash(c, 10) })),
  );
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await db.insert(recoveryCodes).values(rows);
  return codes;
}

export async function countUnusedRecoveryCodes(userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(recoveryCodes)
    .where(
      and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)),
    );
  return rows.length;
}

// Verify + consume (single-use). Returns true if a matching unused code was found.
export async function consumeRecoveryCode(
  userId: string,
  code: string,
): Promise<boolean> {
  const candidate = normalizeCode(code);
  const rows = await db
    .select()
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
  for (const row of rows) {
    if (await bcrypt.compare(candidate, row.codeHash)) {
      // Atomic single-use: only the request that flips used_at from NULL wins;
      // a concurrent second use of the same code updates 0 rows and fails.
      const claimed = await db
        .update(recoveryCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(recoveryCodes.id, row.id), isNull(recoveryCodes.usedAt)))
        .returning({ id: recoveryCodes.id });
      return claimed.length > 0;
    }
  }
  return false;
}
