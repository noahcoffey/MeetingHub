import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens } from "@/db/schema";
import { listWorkspaces } from "./workspaces";

export type ApiTokenScope = "read" | "write";

// Everything about a token except its hash — safe to list and send to the UI.
export type SafeApiToken = {
  id: string;
  name: string;
  tokenPrefix: string;
  scope: ApiTokenScope;
  workspaceIds: string[] | null;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
};

// The resolved identity a verified bearer token grants a /api/v1 request.
export type ApiPrincipal = {
  tokenId: string;
  scope: ApiTokenScope;
  // null = all workspaces; otherwise the stored restriction intersected with
  // the workspaces that still exist (stale ids from deleted workspaces drop out).
  allowedWorkspaceIds: string[] | null;
};

const SECRET_PREFIX = "mh_";
const PREFIX_DISPLAY_LEN = 12;
// How often lastUsedAt is worth persisting — one write per token per minute max.
const LAST_USED_WRITE_MS = 60_000;

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

const SAFE_COLUMNS = {
  id: apiTokens.id,
  name: apiTokens.name,
  tokenPrefix: apiTokens.tokenPrefix,
  scope: apiTokens.scope,
  workspaceIds: apiTokens.workspaceIds,
  expiresAt: apiTokens.expiresAt,
  lastUsedAt: apiTokens.lastUsedAt,
  createdAt: apiTokens.createdAt,
};

export async function createApiToken(
  userId: string,
  input: {
    name: string;
    scope: ApiTokenScope;
    workspaceIds: string[] | null;
    expiresAt?: Date | null;
  },
): Promise<{ token: SafeApiToken; secret: string }> {
  let workspaceIds: string[] | null = null;
  if (input.workspaceIds && input.workspaceIds.length > 0) {
    const known = new Set((await listWorkspaces()).map((w) => w.id));
    const unknown = input.workspaceIds.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(`unknown workspace id: ${unknown[0]}`);
    }
    workspaceIds = [...new Set(input.workspaceIds)];
  }

  const secret = SECRET_PREFIX + randomBytes(32).toString("base64url");
  const [token] = await db
    .insert(apiTokens)
    .values({
      userId,
      name: input.name,
      tokenPrefix: secret.slice(0, PREFIX_DISPLAY_LEN),
      tokenHash: hashSecret(secret),
      scope: input.scope,
      workspaceIds,
      expiresAt: input.expiresAt ?? null,
    })
    .returning(SAFE_COLUMNS);
  return { token, secret };
}

export async function listApiTokens(): Promise<SafeApiToken[]> {
  return db
    .select(SAFE_COLUMNS)
    .from(apiTokens)
    .orderBy(desc(apiTokens.createdAt));
}

export async function getApiToken(
  id: string,
): Promise<SafeApiToken | undefined> {
  const [token] = await db
    .select(SAFE_COLUMNS)
    .from(apiTokens)
    .where(eq(apiTokens.id, id))
    .limit(1);
  return token;
}

// Revocation is a hard delete: a deleted token 401s identically to one that
// never existed, and the single-user list stays free of dead rows.
export async function deleteApiToken(id: string): Promise<void> {
  await db.delete(apiTokens).where(eq(apiTokens.id, id));
}

// Verify a presented bearer secret. Returns the principal, or null for any
// invalid/expired token (callers 401 without distinguishing why).
export async function verifyApiToken(
  bearer: string,
): Promise<ApiPrincipal | null> {
  if (
    !bearer.startsWith(SECRET_PREFIX) ||
    bearer.length < 20 ||
    bearer.length > 100
  ) {
    return null;
  }

  const [row] = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashSecret(bearer)))
    .limit(1);
  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  let allowedWorkspaceIds: string[] | null = null;
  if (row.workspaceIds && row.workspaceIds.length > 0) {
    const live = new Set((await listWorkspaces()).map((w) => w.id));
    allowedWorkspaceIds = row.workspaceIds.filter((id) => live.has(id));
  }

  // Throttled, fire-and-forget freshness marker — never on the request path.
  if (
    !row.lastUsedAt ||
    Date.now() - row.lastUsedAt.getTime() > LAST_USED_WRITE_MS
  ) {
    void db
      .update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, row.id))
      .catch(() => {});
  }

  return { tokenId: row.id, scope: row.scope, allowedWorkspaceIds };
}
