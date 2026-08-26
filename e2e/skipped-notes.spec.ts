import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_PASSWORD } from "./constants";

// A fixed historical day so the seeded rows are the only thing on it.
const DAY = "2021-03-04";
// 15:00Z = 10:00 in America/New_York, the app's default tz.
const AT = (h: number) => `2021-03-04 ${String(h + 5).padStart(2, "0")}:00:00+00`;

async function seed() {
  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  const [ws] =
    await sql`select id from workspaces where is_default = true limit 1`;
  await sql`delete from meetings`;
  await sql`insert into meetings
      (workspace_id, calendar_event_id, title, start_time, source, skipped, notes_generated)
    values (${ws.id}, 'e2e-stranded', 'Cancelled sync', ${AT(9)}, 'calendar', true, '## Pushed notes')`;
  await sql`insert into meetings
      (workspace_id, calendar_event_id, title, start_time, source)
    values (${ws.id}, 'e2e-target', 'Real sync', ${AT(10)}, 'calendar')`;
  await sql.end();
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use password" }).click();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

const dayUrl = `/meetings?date=${DAY}&view=day`;

test("stranded Notes+ on a skipped meeting can be moved to another meeting", async ({
  page,
}) => {
  await seed();
  await login(page);
  await page.goto(dayUrl);

  const banner = page.locator(".skipped-notes-row");
  await expect(banner).toContainText("Cancelled sync");
  await expect(banner.locator(".badge-notes-plus")).toBeVisible();

  await banner.getByRole("button", { name: "Move…" }).click();
  const select = banner.locator("select");
  await expect
    .poll(async () => await select.locator("option").count())
    .toBeGreaterThan(1);
  const targetValue = await select
    .locator("option", { hasText: "Real sync" })
    .getAttribute("value");
  await select.selectOption(targetValue!);

  const moved = page.waitForResponse(
    (r) => r.url().includes("/move-notes") && r.request().method() === "POST",
  );
  await banner.getByRole("button", { name: "Move notes" }).click();
  expect((await moved).status()).toBe(200);

  // The prompt clears and the target now carries the Notes+ badge.
  await expect(page.locator(".skipped-notes-row")).toHaveCount(0);
  await expect(
    page.locator(".meeting-li", { hasText: "Real sync" }).locator(".badge-notes-plus"),
  ).toBeVisible();
});

test("the skipped meeting can be restored instead", async ({ page }) => {
  await seed();
  await login(page);
  await page.goto(dayUrl);

  const banner = page.locator(".skipped-notes-row");
  await expect(banner).toContainText("Cancelled sync");
  const restored = page.waitForResponse(
    (r) => r.url().includes("/skip") && r.request().method() === "DELETE",
  );
  await banner.getByRole("button", { name: "Restore" }).click();
  expect((await restored).status()).toBe(200);

  await expect(page.locator(".skipped-notes-row")).toHaveCount(0);
  await expect(
    page.locator(".meeting-li", { hasText: "Cancelled sync" }),
  ).toBeVisible();
});
