import { test, expect, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "./constants";

// Full OAuth consent flow for the MCP connector: dynamic client registration
// -> session-gated consent screen -> approval redirect with a code -> PKCE
// token exchange -> the minted bearer works against /api/v1.
//
// The redirect_uri points back at this same app (loopback http is an allowed
// registration target), so the post-approve navigation lands on a real page
// whose URL we can read the code from.

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use password" }).click();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function pkce() {
  // Playwright tests run in node — crypto.subtle is available globally.
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = Buffer.from(bytes).toString("base64url");
  return crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(verifier))
    .then((digest) => ({
      verifier,
      challenge: Buffer.from(digest).toString("base64url"),
    }));
}

test("MCP connector OAuth flow: register, consent, exchange, use", async ({
  page,
  baseURL,
  request,
}) => {
  const redirectUri = `${baseURL}/api/health`;

  const reg = await request.post("/api/oauth/register", {
    data: { redirect_uris: [redirectUri], client_name: "E2E Claude" },
  });
  expect(reg.status()).toBe(201);
  const { client_id: clientId } = (await reg.json()) as { client_id: string };

  const { verifier, challenge } = await pkce();
  const state = `st-${Date.now()}`;

  await login(page);
  const authorizeUrl =
    `/oauth/authorize?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code&state=${state}` +
    `&code_challenge=${challenge}&code_challenge_method=S256&scope=read write`;
  await page.goto(authorizeUrl);

  await expect(
    page.getByRole("heading", { name: /Connect .E2E Claude./ }),
  ).toBeVisible();
  // scope=... write in the request preselects read & write.
  await expect(page.getByRole("radio", { name: /Read & write/ })).toBeChecked();

  await page.getByRole("button", { name: "Approve" }).click();
  await page.waitForURL((url) => url.searchParams.has("code"));

  const landed = new URL(page.url());
  expect(landed.pathname).toBe("/api/health");
  expect(landed.searchParams.get("state")).toBe(state);
  const code = landed.searchParams.get("code")!;

  const tokenRes = await request.post("/api/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
      code_verifier: verifier,
    },
  });
  expect(tokenRes.status()).toBe(200);
  const tokenJson = (await tokenRes.json()) as {
    access_token: string;
    scope: string;
  };
  expect(tokenJson.access_token).toMatch(/^mh_/);
  expect(tokenJson.scope).toBe("write");

  const v1 = await request.get("/api/v1/me", {
    headers: { authorization: `Bearer ${tokenJson.access_token}` },
  });
  expect(v1.status()).toBe(200);
  const me = (await v1.json()) as { scope: string; name: string };
  expect(me.scope).toBe("write");
  expect(me.name).toContain("E2E Claude");

  // Clean up the minted token so it doesn't accumulate in the shared e2e DB
  // (page.request carries the logged-in session the settings API needs).
  const listed = await page.request.get("/api/api-tokens");
  const { tokens } = (await listed.json()) as {
    tokens: { id: string; name: string }[];
  };
  for (const t of tokens.filter((t) => t.name.includes("E2E Claude"))) {
    await page.request.delete(`/api/api-tokens/${t.id}`);
  }
});

test("consent screen refuses an unregistered redirect_uri", async ({
  page,
  request,
}) => {
  const reg = await request.post("/api/oauth/register", {
    data: {
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      client_name: "E2E Strict",
    },
  });
  const { client_id: clientId } = (await reg.json()) as { client_id: string };

  await login(page);
  await page.goto(
    `/oauth/authorize?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent("https://evil.example.com/cb")}` +
      `&response_type=code&code_challenge=${"a".repeat(43)}&code_challenge_method=S256`,
  );
  // Scope to the card's error (Next's route announcer is also role=alert).
  await expect(page.locator(".login-error")).toContainText(
    /redirect URL it didn't register/,
  );
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
});
