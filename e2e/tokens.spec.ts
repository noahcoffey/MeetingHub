import { test, expect } from "@playwright/test";
import { E2E_PASSWORD } from "./constants";

// Signs in through the real password form (single-user app: password only).
async function login(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use password" }).click();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test("create, use, and revoke an API token from Settings", async ({ page }) => {
  await login(page);

  await page.goto("/settings/tokens");
  await expect(
    page.getByRole("heading", { name: "API tokens" }),
  ).toBeVisible();

  let secret = "";

  await test.step("create a read+write token", async () => {
    await page.getByLabel("Token name").fill("E2E Token");
    await page.getByLabel("Read + write").check();
    // Leave "All workspaces" checked and expiry at "Never".
    await page.getByRole("button", { name: "Create token" }).click();

    // One-time secret modal.
    await expect(page.getByText("Save your token")).toBeVisible();
    secret = (await page.locator(".sec-codes-grid li").innerText()).trim();
    expect(secret).toMatch(/^mh_/);
    await page.getByRole("button", { name: /saved it/i }).click();
  });

  await test.step("the token shows in the active list", async () => {
    const row = page.locator(".sec-item", { hasText: "E2E Token" });
    await expect(row).toBeVisible();
    await expect(row.getByText("Read + write")).toBeVisible();
    await expect(row.getByText("All workspaces")).toBeVisible();
  });

  await test.step("the secret authenticates against /api/v1", async () => {
    const res = await page.request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.scope).toBe("write");
    expect(body.allWorkspaces).toBe(true);
  });

  await test.step("revoking it stops the secret working", async () => {
    await page.getByRole("button", { name: "Revoke" }).click();
    // The list removes the row optimistically, so wait for the server DELETE to
    // land before checking the token — otherwise the re-check races the delete.
    const deleted = page.waitForResponse(
      (r) =>
        r.url().includes("/api/api-tokens/") &&
        r.request().method() === "DELETE",
    );
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Revoke" })
      .click();
    await deleted;
    await expect(page.locator(".sec-item", { hasText: "E2E Token" })).toHaveCount(
      0,
    );

    const res = await page.request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(res.status()).toBe(401);
  });
});

test("a read-only token is rejected for writes", async ({ page }) => {
  await login(page);
  await page.goto("/settings/tokens");

  await page.getByLabel("Token name").fill("Read Only");
  // "Read-only" is the default scope; create without changing it.
  await page.getByRole("button", { name: "Create token" }).click();
  await expect(page.getByText("Save your token")).toBeVisible();
  const secret = (await page.locator(".sec-codes-grid li").innerText()).trim();
  await page.getByRole("button", { name: /saved it/i }).click();

  // Reads succeed, writes are refused.
  const read = await page.request.get("/api/v1/workspaces", {
    headers: { Authorization: `Bearer ${secret}` },
  });
  expect(read.status()).toBe(200);

  const write = await page.request.post("/api/v1/projects", {
    headers: { Authorization: `Bearer ${secret}` },
    data: { name: "nope" },
  });
  expect(write.status()).toBe(403);
});
