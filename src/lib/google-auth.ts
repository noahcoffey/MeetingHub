import "server-only";

// Shared Google OAuth plumbing for every Google integration (Calendar import,
// Drive files). Feature modules own their scopes and redirect paths; this file
// owns credentials, the consent/token endpoints, and the fetch discipline.

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

export const FETCH_TIMEOUT_MS = 15_000;

export class GoogleNotConfiguredError extends Error {
  constructor() {
    super("Google OAuth is not configured");
    this.name = "GoogleNotConfiguredError";
  }
}

export function googleConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

function clientCreds(): { id: string; secret: string } {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!id || !secret) throw new GoogleNotConfiguredError();
  return { id, secret };
}

export async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Build the consent URL. access_type=offline + prompt=consent forces a refresh
// token even on re-consent; include_granted_scopes merges with any scopes the
// same account already granted (so connecting Drive keeps Calendar working).
export function buildAuthUrl(opts: {
  scope: string;
  redirectUri: string;
  state: string;
}): string {
  const { id } = clientCreds();
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: opts.redirectUri,
    response_type: "code",
    scope: opts.scope,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: opts.state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

// Exchange an authorization code for tokens. The redirect URI must exactly
// match the one used in the consent URL.
export async function exchangeCode(
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string; scope: string }> {
  const { id, secret } = clientCreds();
  const res = await timedFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: id,
      client_secret: secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error("google code exchange failed");
  const json = (await res.json()) as {
    refresh_token?: string;
    access_token?: string;
    scope?: string;
  };
  if (!json.refresh_token || !json.access_token) {
    // No refresh token means the account was already consented without offline
    // access — the caller should tell the user to remove app access & retry.
    throw new Error("google did not return a refresh token");
  }
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    scope: json.scope ?? "",
  };
}

export async function fetchUserEmail(accessToken: string): Promise<string> {
  const res = await timedFetch(USERINFO_URL, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("google userinfo failed");
  const json = (await res.json()) as { email?: string };
  if (!json.email) throw new Error("google account has no email");
  return json.email.toLowerCase();
}

// Thrown when Google rejects the refresh token itself (revoked access) — the
// caller should surface a "reconnect" state rather than a generic failure.
export class GoogleAuthError extends Error {
  constructor() {
    super("google refresh token rejected");
    this.name = "GoogleAuthError";
  }
}

export async function accessTokenFromRefresh(
  refreshToken: string,
): Promise<string> {
  const { id, secret } = clientCreds();
  const res = await timedFetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    // 400 invalid_grant / 401 = the grant is gone (user revoked access).
    if (res.status === 400 || res.status === 401) throw new GoogleAuthError();
    throw new Error("google token refresh failed");
  }
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token)
    throw new Error("google token refresh returned no token");
  return json.access_token;
}
