"use server";

import { auth } from "@/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { createAuthorizationCode, getOauthClient } from "@/lib/oauth";
import { listWorkspaces } from "@/lib/workspaces";

// Consent approval. Returns the redirect target instead of redirect()ing so
// the client component can navigate via window.location — a server-action
// redirect to a cross-origin URL would trip the CSP's form-action 'self'.

export type ApproveState =
  | { error: string }
  | { redirectTo: string }
  | null;

export async function approve(
  _prev: ApproveState,
  formData: FormData,
): Promise<ApproveState> {
  const session = await auth();
  if (!session?.user) return { error: "Not signed in." };
  // Single-user app: the grant always belongs to the seeded user.
  const [user] = await db.select({ id: users.id }).from(users).limit(1);
  if (!user) return { error: "No user found." };

  const clientId = String(formData.get("client_id") ?? "");
  const redirectUri = String(formData.get("redirect_uri") ?? "");
  const oauthState = String(formData.get("state") ?? "");
  const codeChallenge = String(formData.get("code_challenge") ?? "");
  const scope = formData.get("scope") === "write" ? "write" : "read";
  const pickedWorkspaces = formData
    .getAll("workspaces")
    .map(String)
    .filter(Boolean);

  // Re-validate everything — hidden fields are attacker-visible inputs.
  const client = await getOauthClient(clientId).catch(() => undefined);
  if (!client) return { error: "Unknown client." };
  if (!client.redirectUris.includes(redirectUri)) {
    return { error: "Redirect URL not registered by this client." };
  }
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge)) {
    return { error: "Invalid PKCE challenge." };
  }
  const known = new Set((await listWorkspaces()).map((w) => w.id));
  if (!pickedWorkspaces.every((id) => known.has(id))) {
    return { error: "Unknown workspace selected." };
  }

  const code = await createAuthorizationCode({
    userId: user.id,
    clientId,
    redirectUri,
    codeChallenge,
    scope,
    workspaceIds: pickedWorkspaces.length > 0 ? pickedWorkspaces : null,
  });

  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (oauthState) url.searchParams.set("state", oauthState);
  return { redirectTo: url.toString() };
}
