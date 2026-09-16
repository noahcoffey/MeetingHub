import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_PASSWORD } from "./constants";

async function seedNote(title: string, body = ""): Promise<string> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  const [ws] = await sql`select id from workspaces where is_default = true limit 1`;
  await sql`delete from notes`;
  const [n] = await sql`insert into notes (workspace_id, title, notes)
    values (${ws.id}, ${title}, ${body}) returning id`;
  await sql.end();
  return n.id;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use password" }).click();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

// Drives a real paste: ProseMirror's handlePaste reads clipboardData off the
// event, so a synthetic ClipboardEvent carrying a DataTransfer is exactly what
// the browser would deliver. (page.keyboard can't populate the system clipboard
// headlessly.)
async function pasteText(page: Page, text: string) {
  await page.locator(".ProseMirror").click();
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData("text/plain", t);
    document
      .querySelector(".ProseMirror")!
      .dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
  }, text);
}

test("pasting a URL resolves it to a titled link", async ({ page }) => {
  const id = await seedNote("Link paste");
  // Stub the resolver so the test never depends on the open internet.
  await page.route("**/api/link-title?*", (route) =>
    route.fulfill({ json: { title: "Example Domain" } }),
  );
  await login(page);
  await page.goto(`/notes/${id}`);
  await page.waitForSelector(".ProseMirror");

  await pasteText(page, "https://example.com/deep/page");

  const link = page.locator(".ProseMirror a").first();
  // The bare URL goes in immediately, so nothing is lost if the fetch is slow…
  await expect(link).toHaveAttribute("href", "https://example.com/deep/page");
  // …then the title replaces the link text in place.
  await expect(link).toHaveText("Example Domain");

  // And it round-trips to markdown as [Title](url) — check what actually saved.
  const saved = page.waitForResponse(
    (r) => r.url().includes(`/api/notes/${id}`) && r.request().method() === "PATCH" && r.ok(),
  );
  // Type straight on from where the paste left the caret — the real gesture.
  await page.keyboard.type(" done");
  await saved;
  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  const [row] = await sql`select notes from notes where id = ${id}`;
  await sql.end();
  // Crucially the typed text is OUTSIDE the link — the caret must not be left
  // inside it, or the rest of the sentence gets swallowed into the link text.
  expect(row.notes).toContain(
    "[Example Domain](https://example.com/deep/page) done",
  );
});

test("a URL pasted over a selection, or with other text, is left alone", async ({
  page,
}) => {
  const id = await seedNote("Link paste 2", "keep me");
  let resolverCalls = 0;
  await page.route("**/api/link-title?*", (route) => {
    resolverCalls += 1;
    return route.fulfill({ json: { title: "Nope" } });
  });
  await login(page);
  await page.goto(`/notes/${id}`);
  await page.waitForSelector(".ProseMirror");

  // Multi-token paste: normal paste handling, no link resolution.
  await pasteText(page, "see https://example.com for details");
  await expect(page.locator(".ProseMirror")).toContainText("see https://");
  expect(resolverCalls).toBe(0);
});

test("a note can be shared publicly and revoked", async ({ page, browser }) => {
  const id = await seedNote("Shared plan", "## Heading\n\nBody text here.");
  await login(page);
  await page.goto(`/notes/${id}`);
  await page.waitForSelector(".ProseMirror");

  await page.getByRole("button", { name: "Share note" }).click();
  const shared = page.waitForResponse(
    (r) => r.url().includes(`/notes/${id}/share`) && r.request().method() === "POST" && r.ok(),
  );
  await page.getByRole("radio", { name: /Public link/ }).click();
  await shared;

  const url = await page.locator("input.share-url").inputValue();
  expect(url).toMatch(/\/s\/[A-Za-z0-9_-]{22}$/);

  // A brand-new context: no session cookie at all.
  const anon = await browser.newContext();
  const guest = await anon.newPage();
  await guest.goto(url);
  await expect(guest.getByRole("heading", { name: "Shared plan" })).toBeVisible();
  await expect(guest.locator(".ProseMirror")).toContainText("Body text here.");
  // The public page carries none of the app's chrome.
  await expect(guest.locator("nav")).toHaveCount(0);
  await expect(guest.locator("a[href^='/notes']")).toHaveCount(0);

  // Revoke: the same link is dead, and it stays dead after re-sharing.
  const revoked = page.waitForResponse(
    (r) => r.url().includes(`/notes/${id}/share`) && r.request().method() === "DELETE" && r.ok(),
  );
  await page.getByRole("radio", { name: /Private/ }).click();
  await revoked;

  await guest.goto(url);
  await expect(guest.getByRole("heading", { name: "Link not available" })).toBeVisible();

  const reshared = page.waitForResponse(
    (r) => r.url().includes(`/notes/${id}/share`) && r.request().method() === "POST" && r.ok(),
  );
  await page.getByRole("radio", { name: /Public link/ }).click();
  await reshared;
  const url2 = await page.locator("input.share-url").inputValue();
  expect(url2).not.toBe(url);

  await guest.goto(url);
  await expect(guest.getByRole("heading", { name: "Link not available" })).toBeVisible();
  await anon.close();
});

// The app must never be wider than the viewport on a phone — horizontal
// overflow makes the whole thing pannable and drags the sticky top bar with it.
test("the share modal and the public page fit a 320px viewport", async ({
  page,
  browser,
}) => {
  const id = await seedNote("Narrow", "Body text here.");
  await page.setViewportSize({ width: 320, height: 720 });
  await login(page);
  await page.goto(`/notes/${id}`);
  await page.waitForSelector(".ProseMirror");

  await page.getByRole("button", { name: "Share note" }).click();
  const shared = page.waitForResponse(
    (r) => r.url().includes(`/notes/${id}/share`) && r.request().method() === "POST" && r.ok(),
  );
  await page.getByRole("radio", { name: /Public link/ }).click();
  await shared;
  await expect(page.locator("input.share-url")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);

  const url = await page.locator("input.share-url").inputValue();
  const anon = await browser.newContext({ viewport: { width: 320, height: 720 } });
  const guest = await anon.newPage();
  await guest.goto(url);
  await expect(guest.locator(".ProseMirror")).toContainText("Body text here.");
  expect(
    await guest.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(320);
  await anon.close();
});
