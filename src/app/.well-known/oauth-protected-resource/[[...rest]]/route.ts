import { getPublicOrigin } from "mcp-handler";
import { corsPreflight, oauthJson } from "@/lib/oauth-http";

// RFC 9728 protected-resource metadata for the /api/mcp endpoint. The
// optional catch-all also answers the path-inserted form
// (/.well-known/oauth-protected-resource/api/mcp) some clients derive.

export const dynamic = "force-dynamic";

export function GET(req: Request): Response {
  const origin = getPublicOrigin(req);
  return oauthJson({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ["read", "write"],
    bearer_methods_supported: ["header"],
    resource_name: "Meeting Hub",
  });
}

export function OPTIONS(): Response {
  return corsPreflight();
}
