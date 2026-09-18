import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_PASSWORD } from "./constants";

// 15:00Z = 10:00 in America/New_York, the app's default tz.
const AT = (h: number) => `2021-03-05 ${String(h + 5).padStart(2, "0")}:00:00+00`;

// A push that auto-matched a SKIPPED meeting (the day view never shows it, so
// the notes look lost) and was written there — the exact case the log exists for.
async function seed(): Promise<{ wrongId: string; rightId: string }> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  const [ws] =
    await sql`select id from workspaces where is_default = true limit 1`;
  await sql`delete from ingest_events`;
  await sql`delete from pending_ingests`;
  await sql`delete from meetings`;
  const [wrong] = await sql`insert into meetings
      (workspace_id, calendar_event_id, title, start_time, source, skipped, notes_generated)
    values (${ws.id}, 'e2e-uid', 'Wrong meeting', ${AT(9)}, 'calendar', true, '## Recorded notes')
    returning id`;
  const [right] = await sql`insert into meetings
      (workspace_id, calendar_event_id, title, start_time, source)
    values (${ws.id}, 'e2e-right', 'Right meeting', ${AT(10)}, 'calendar')
    returning id`;
  await sql`insert into ingest_events
      (source_id, title, start_time, notes_generated, outcome, matched_meeting_id, meeting_id)
    values ('e2e-uid', 'Recorder title', ${AT(9)}, '## Recorded notes', 'matched_written', ${wrong.id}, ${wrong.id})`;
  await sql.end();
  return { wrongId: wrong.id, rightId: right.id };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use password" }).click();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("the ingest log shows where a push landed and can re-associate it", async ({
  page,
}) => {
  const { wrongId, rightId } = await seed();
  await login(page);
  await page.goto("/settings/ingest-log");

  const row = page.locator(".ingest-row").first();
  await expect(row).toContainText("Recorder title");
  await expect(row).toContainText("Matched · notes written");
  await expect(row.locator(".ingest-flag", { hasText: "Skipped" })).toBeVisible();
  await expect(row.getByRole("link", { name: "Wrong meeting" })).toHaveAttribute(
    "href",
    `/meetings/${wrongId}`,
  );

  await row.getByRole("button", { name: "Re-associate…" }).click();
  const select = row.getByLabel("Target meeting", { exact: true });
  await expect
    .poll(async () => await select.locator("option").count())
    .toBeGreaterThan(1);
  const value = await select
    .locator("option", { hasText: "Right meeting" })
    .getAttribute("value");
  await select.selectOption(value!);
  await row.getByRole("button", { name: "Move notes" }).click();

  await expect(row.getByRole("link", { name: "Right meeting" })).toHaveAttribute(
    "href",
    `/meetings/${rightId}`,
  );
  await expect(row.locator(".ingest-pill", { hasText: "Re-associated" })).toBeVisible();
  await expect(row).toContainText("Originally landed on");
  await page.screenshot({ path: "test-results/ingest-log.png", fullPage: true });

  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  const [right] = await sql`select notes_generated, external_ref from meetings where id = ${rightId}`;
  const [wrong] = await sql`select notes_generated from meetings where id = ${wrongId}`;
  await sql.end();
  expect(right.notes_generated).toBe("## Recorded notes");
  expect(right.external_ref).toBe("e2e-uid");
  expect(wrong.notes_generated).toBeNull();
});
