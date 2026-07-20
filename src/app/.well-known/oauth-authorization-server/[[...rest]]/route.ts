import { getPublicOrigin } from "mcp-handler";
import { corsPreflight, oauthJson } from "@/lib/oauth-http";

// RFC 8414 authorization-server metadata for the built-in OAuth server that
// fronts the MCP connector. Public clients only: PKCE S256, no client secret,
// dynamic registration.

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  const origin = getPublicOrigin(req);
  return oauthJson({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/oauth/token`,
    registration_endpoint: `${origin}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["read", "write"],
  });
}

export function OPTIONS(): Response {
  return corsPreflight();
}
