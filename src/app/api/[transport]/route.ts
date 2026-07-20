import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { verifyApiToken } from "@/lib/api-tokens";
import { registerTools } from "./tools";

// MCP endpoint (streamable HTTP, stateless) at /api/mcp — the URL to paste
// into claude.ai -> Settings -> Connectors -> "Add custom connector". Auth is
// a bearer token from the built-in OAuth flow (see src/lib/oauth.ts); tokens
// are ordinary api_tokens rows, so verification is shared with /api/v1.
// SSE (the deprecated transport) is disabled — it would require Redis.
// Excluded from the session middleware matcher like the other bearer surfaces.

const handler = createMcpHandler(
  (server) => {
    registerTools(server);
  },
  { serverInfo: { name: "meeting-hub", version: "1.0.0" } },
  { basePath: "/api", disableSse: true, verboseLogs: false },
);

const authed = withMcpAuth(
  handler,
  async (_req, bearer) => {
    if (!bearer) return undefined;
    const principal = await verifyApiToken(bearer);
    if (!principal) return undefined;
    return {
      token: bearer,
      clientId: principal.tokenId,
      scopes: [principal.scope],
    };
  },
  // 401s carry WWW-Authenticate pointing at the RFC 9728 metadata, which is
  // how claude.ai discovers the OAuth flow.
  { required: true, resourceMetadataPath: "/.well-known/oauth-protected-resource" },
);

export { authed as GET, authed as POST, authed as DELETE };
