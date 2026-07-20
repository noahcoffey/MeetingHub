// Shared bits for the OAuth/MCP HTTP surface (metadata + register + token).
// These endpoints are called cross-origin by MCP clients running in browsers,
// so they answer preflights and carry permissive CORS — they expose no user
// data (metadata is public; register/token only act on what the caller
// already holds).

export const OAUTH_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, mcp-protocol-version",
  "Access-Control-Max-Age": "86400",
};

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: OAUTH_CORS_HEADERS });
}

export function oauthJson(
  body: unknown,
  init: { status?: number } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      ...OAUTH_CORS_HEADERS,
      "content-type": "application/json",
      "cache-control": "no-store",
    },
  });
}
