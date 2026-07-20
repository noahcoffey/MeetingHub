import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { oauthClients, oauthCodes, type OauthClient } from "@/db/schema";
import {
  createApiToken,
  type ApiTokenScope,
} from "./api-tokens";

// Minimal OAuth 2.1 authorization server for the MCP connector (see
// src/app/api/[transport]/route.ts). Single-user: the only account that can
// approve a grant is the seeded user, and every approved grant is stored as a
// regular api_tokens row (name-tagged with the client), so Settings -> API
// tokens is the one revocation surface.

const CODE_TTL_MS = 10 * 60 * 1000;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

// Public clients only (PKCE, token_endpoint_auth_method "none"): loopback http
// for local tooling, https for everything else (claude.ai).
export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}

export async function registerOauthClient(input: {
  name: string;
  redirectUris: string[];
}): Promise<OauthClient> {
  const [row] = await db
    .insert(oauthClients)
    .values({ name: input.name, redirectUris: input.redirectUris })
    .returning();
  return row;
}

export async function getOauthClient(
  clientId: string,
): Promise<OauthClient | undefined> {
  const [row] = await db
    .select()
    .from(oauthClients)
    .where(eq(oauthClients.id, clientId))
    .limit(1);
  return row;
}

// Mint a single-use authorization code carrying the consent choices. The
// plaintext code only ever travels in the redirect back to the client.
export async function createAuthorizationCode(input: {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: ApiTokenScope;
  workspaceIds: string[] | null;
}): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await db.insert(oauthCodes).values({
    codeHash: sha256Hex(code),
    clientId: input.clientId,
    userId: input.userId,
    redirectUri: input.redirectUri,
    codeChallenge: input.codeChallenge,
    scope: input.scope,
    workspaceIds:
      input.workspaceIds && input.workspaceIds.length > 0
        ? input.workspaceIds
        : null,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  // Opportunistic sweep so abandoned flows don't accumulate rows.
  void db
    .delete(oauthCodes)
    .where(lt(oauthCodes.expiresAt, new Date()))
    .catch(() => {});
  return code;
}

export type RedeemResult =
  | { ok: true; accessToken: string; scope: ApiTokenScope }
  | { ok: false; error: "invalid_grant" | "invalid_request" };

// Exchange code + PKCE verifier for an access token. The code row is deleted
// before the token is minted, so a replayed code always fails.
export async function redeemAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<RedeemResult> {
  const [row] = await db
    .delete(oauthCodes)
    .where(
      and(
        eq(oauthCodes.codeHash, sha256Hex(input.code)),
        eq(oauthCodes.clientId, input.clientId),
      ),
    )
    .returning();
  if (!row) return { ok: false, error: "invalid_grant" };
  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "invalid_grant" };
  }
  if (row.redirectUri !== input.redirectUri) {
    return { ok: false, error: "invalid_grant" };
  }
  const challenge = createHash("sha256")
    .update(input.codeVerifier)
    .digest("base64url");
  if (challenge !== row.codeChallenge) {
    return { ok: false, error: "invalid_grant" };
  }

  const client = await getOauthClient(row.clientId);
  const day = new Date().toISOString().slice(0, 10);
  const { secret } = await createApiToken(row.userId, {
    name: `${client?.name ?? "OAuth client"} (connector, ${day})`,
    scope: row.scope,
    workspaceIds: row.workspaceIds,
    expiresAt: null,
  });
  return { ok: true, accessToken: secret, scope: row.scope };
}
