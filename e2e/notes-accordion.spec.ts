import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_PASSWORD } from "./constants";

const AT = "2021-03-05 15:00:00+00";

async function seed(withGenerated: boolean): Promise<string> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  const [ws] = await sql`select id from workspaces where is_default = true limit 1`;
  await sql`delete from meetings`;
  const [m] = await sql`insert into meetings
      (workspace_id, calendar_event_id, title, start_time, source, notes, notes_generated)
    values (${ws.id}, 'e2e-acc', 'Layout check', ${AT}, 'calendar',
      'Plain first paragraph.', ${withGenerated ? "## Summary\n\nGenerated body." : null})
    returning id`;
  await sql.end();
  return m.id;
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use password" }).click();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

const openTitles = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".nsec.open .nsec-head-inner span")].map(
      (e) => e.textContent,
    ),
  );

test("collapsing the open section opens the other", async ({ page }) => {
  const id = await seed(true);
  await login(page);
  await page.goto(`/meetings/${id}`);
  await page.waitForSelector(".ProseMirror");

  const head = (i: number) => page.locator(".nsec .nsec-head").nth(i);
  expect(await openTitles(page)).toEqual(["Notes"]);

  // Click the OPEN header -> hands off to Generated.
  await head(0).click();
  await expect.poll(() => openTitles(page)).toEqual(["Generated notes"]);

  // Click the now-open Generated header -> hands back to Notes.
  await head(1).click();
  await expect.poll(() => openTitles(page)).toEqual(["Notes"]);

  // Clicking the closed one still just opens it.
  await head(1).click();
  await expect.poll(() => openTitles(page)).toEqual(["Generated notes"]);
});

test("with no generated notes, Notes still collapses to a header bar", async ({
  page,
}) => {
  const id = await seed(false);
  await login(page);
  await page.goto(`/meetings/${id}`);
  await page.waitForSelector(".ProseMirror");

  expect(await page.locator(".nsec").count()).toBe(1);
  expect(await openTitles(page)).toEqual(["Notes"]);
  await page.locator(".nsec .nsec-head").first().click();
  await expect.poll(() => openTitles(page)).toEqual([]);
});
