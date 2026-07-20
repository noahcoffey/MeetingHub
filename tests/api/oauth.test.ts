import { beforeEach, describe, expect, it } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { oauthCodes } from "@/db/schema";
import { POST as register } from "@/app/api/oauth/register/route";
import { POST as token } from "@/app/api/oauth/token/route";
import { GET as v1Workspaces } from "@/app/api/v1/workspaces/route";
import {
  createAuthorizationCode,
  registerOauthClient,
} from "@/lib/oauth";
import { call, makeWorkspace, resetDb } from "../helpers";
import { TEST_USER_ID } from "../constants";

const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

let wsA: string;
let wsB: string;

beforeEach(async () => {
  await resetDb();
  wsA = await makeWorkspace("Alpha", { isDefault: true });
  wsB = await makeWorkspace("Beta");
});

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

async function makeGrant(opts?: {
  scope?: "read" | "write";
  workspaceIds?: string[] | null;
}) {
  const client = await registerOauthClient({
    name: "Claude",
    redirectUris: [REDIRECT],
  });
  const { verifier, challenge } = pkcePair();
  const code = await createAuthorizationCode({
    userId: TEST_USER_ID,
    clientId: client.id,
    redirectUri: REDIRECT,
    codeChallenge: challenge,
    scope: opts?.scope ?? "write",
    workspaceIds: opts?.workspaceIds ?? null,
  });
  return { client, code, verifier };
}

function exchangeBody(g: { client: { id: string }; code: string; verifier: string }) {
  return {
    grant_type: "authorization_code",
    code: g.code,
    client_id: g.client.id,
    redirect_uri: REDIRECT,
    code_verifier: g.verifier,
  };
}

describe("dynamic client registration", () => {
  it("registers a client and returns its id", async () => {
    const res = await call(register, {
      method: "POST",
      body: { redirect_uris: [REDIRECT], client_name: "Claude" },
    });
    expect(res.status).toBe(201);
    expect(res.json.client_id).toBeTruthy();
    expect(res.json.token_endpoint_auth_method).toBe("none");
    expect(res.json.redirect_uris).toEqual([REDIRECT]);
  });

  it("allows loopback http but rejects other http redirect uris", async () => {
    const ok = await call(register, {
      method: "POST",
      body: { redirect_uris: ["http://localhost:33418/callback"] },
    });
    expect(ok.status).toBe(201);

    const bad = await call(register, {
      method: "POST",
      body: { redirect_uris: ["http://evil.example.com/callback"] },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("invalid_redirect_uri");
  });

  it("rejects missing or empty redirect_uris", async () => {
    const res = await call(register, {
      method: "POST",
      body: { client_name: "nope" },
    });
    expect(res.status).toBe(400);
  });
});

describe("token exchange", () => {
  it("exchanges a code + verifier for a working access token", async () => {
    const grant = await makeGrant({ scope: "write" });
    const res = await call(token, { method: "POST", body: exchangeBody(grant) });
    expect(res.status).toBe(200);
    expect(String(res.json.access_token)).toMatch(/^mh_/);
    expect(res.json.token_type).toBe("Bearer");
    expect(res.json.scope).toBe("write");

    // The minted token is a live api_tokens bearer.
    const list = await call(v1Workspaces, {
      bearer: String(res.json.access_token),
    });
    expect(list.status).toBe(200);
    const names = (list.json.items as { name: string }[]).map((w) => w.name);
    expect(names).toContain("Alpha");
    expect(names).toContain("Beta");
  });

  it("carries the workspace restriction onto the minted token", async () => {
    const grant = await makeGrant({ scope: "read", workspaceIds: [wsB] });
    const res = await call(token, { method: "POST", body: exchangeBody(grant) });
    expect(res.status).toBe(200);

    const list = await call(v1Workspaces, {
      bearer: String(res.json.access_token),
    });
    const ids = (list.json.items as { id: string }[]).map((w) => w.id);
    expect(ids).toEqual([wsB]);
    expect(ids).not.toContain(wsA);
  });

  it("accepts a form-encoded body (the OAuth default)", async () => {
    const grant = await makeGrant();
    const req = new Request("http://test.local/api/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(
        exchangeBody(grant) as unknown as Record<string, string>,
      ).toString(),
    });
    const res = await token(req);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { access_token: string };
    expect(json.access_token).toMatch(/^mh_/);
  });

  it("rejects a wrong PKCE verifier and burns the code", async () => {
    const grant = await makeGrant();
    const bad = await call(token, {
      method: "POST",
      body: { ...exchangeBody(grant), code_verifier: "A".repeat(43) },
    });
    expect(bad.status).toBe(400);
    expect(bad.json.error).toBe("invalid_grant");

    // Even the right verifier fails now — single use includes failed attempts.
    const retry = await call(token, { method: "POST", body: exchangeBody(grant) });
    expect(retry.status).toBe(400);
  });

  it("rejects code reuse after a successful exchange", async () => {
    const grant = await makeGrant();
    const first = await call(token, { method: "POST", body: exchangeBody(grant) });
    expect(first.status).toBe(200);
    const second = await call(token, { method: "POST", body: exchangeBody(grant) });
    expect(second.status).toBe(400);
    expect(second.json.error).toBe("invalid_grant");
  });

  it("rejects a redirect_uri mismatch", async () => {
    const grant = await makeGrant();
    const res = await call(token, {
      method: "POST",
      body: { ...exchangeBody(grant), redirect_uri: "https://claude.ai/other" },
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_grant");
  });

  it("rejects an expired code", async () => {
    const grant = await makeGrant();
    await db
      .update(oauthCodes)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(oauthCodes.clientId, grant.client.id));
    const res = await call(token, { method: "POST", body: exchangeBody(grant) });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_grant");
  });

  it("rejects unsupported grant types", async () => {
    const res = await call(token, {
      method: "POST",
      body: { grant_type: "client_credentials" },
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("unsupported_grant_type");
  });

  it("rejects a non-uuid client_id without a 500", async () => {
    const grant = await makeGrant();
    const res = await call(token, {
      method: "POST",
      body: { ...exchangeBody(grant), client_id: "not-a-uuid" },
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("invalid_grant");
  });
});
