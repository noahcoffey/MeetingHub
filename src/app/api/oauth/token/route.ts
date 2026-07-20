import { redeemAuthorizationCode } from "@/lib/oauth";
import { corsPreflight, oauthJson } from "@/lib/oauth-http";

// RFC 6749 token endpoint, authorization_code + PKCE only. A successful
// exchange mints a regular api_tokens row (revocable under Settings -> API
// tokens) and returns its secret as a non-expiring bearer access token.

export const dynamic = "force-dynamic";

async function readParams(req: Request): Promise<Record<string, string>> {
  const contentType = req.headers.get("content-type") ?? "";
  const raw = await req.text();
  if (contentType.includes("application/json")) {
    try {
      const body = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(body).filter(
          (e): e is [string, string] => typeof e[1] === "string",
        ),
      );
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

export async function POST(req: Request): Promise<Response> {
  const params = await readParams(req);

  if (params.grant_type !== "authorization_code") {
    return oauthJson({ error: "unsupported_grant_type" }, { status: 400 });
  }
  const code = params.code;
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri;
  const codeVerifier = params.code_verifier;
  if (!code || !clientId || !redirectUri || !codeVerifier) {
    return oauthJson({ error: "invalid_request" }, { status: 400 });
  }

  let result;
  try {
    result = await redeemAuthorizationCode({
      code,
      clientId,
      redirectUri,
      codeVerifier,
    });
  } catch {
    // e.g. client_id that isn't a uuid — Postgres rejects the cast.
    return oauthJson({ error: "invalid_grant" }, { status: 400 });
  }
  if (!result.ok) {
    return oauthJson({ error: result.error }, { status: 400 });
  }
  return oauthJson({
    access_token: result.accessToken,
    token_type: "Bearer",
    scope: result.scope,
  });
}

export function OPTIONS(): Response {
  return corsPreflight();
}
