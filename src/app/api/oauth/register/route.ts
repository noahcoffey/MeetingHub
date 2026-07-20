import { isAllowedRedirectUri, registerOauthClient } from "@/lib/oauth";
import { corsPreflight, oauthJson } from "@/lib/oauth-http";

// RFC 7591 dynamic client registration, open (no initial access token) —
// standard for MCP servers: registering a client grants nothing until the
// logged-in user approves the consent screen at /oauth/authorize.

export const dynamic = "force-dynamic";

const MAX_REDIRECT_URIS = 10;

export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return oauthJson({ error: "invalid_client_metadata" }, { status: 400 });
  }
  const { redirect_uris: redirectUris, client_name: clientName } = (body ??
    {}) as { redirect_uris?: unknown; client_name?: unknown };

  if (
    !Array.isArray(redirectUris) ||
    redirectUris.length === 0 ||
    redirectUris.length > MAX_REDIRECT_URIS ||
    !redirectUris.every(
      (u): u is string => typeof u === "string" && isAllowedRedirectUri(u),
    )
  ) {
    return oauthJson({ error: "invalid_redirect_uri" }, { status: 400 });
  }

  const name =
    typeof clientName === "string" && clientName.trim()
      ? clientName.trim().slice(0, 100)
      : "MCP client";

  const client = await registerOauthClient({ name, redirectUris });
  return oauthJson(
    {
      client_id: client.id,
      client_name: name,
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    },
    { status: 201 },
  );
}

export function OPTIONS(): Response {
  return corsPreflight();
}
