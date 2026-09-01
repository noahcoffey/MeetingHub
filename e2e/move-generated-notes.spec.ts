import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_PASSWORD } from "./constants";

// A fixed historical day so the seeded rows are the only thing on it.
// 15:00Z = 10:00 in America/New_York, the app's default tz.
const AT = (h: number) => `2021-03-05 ${String(h + 5).padStart(2, "0")}:00:00+00`;

async function seed(): Promise<{ sourceId: string; targetId: string }> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  const [ws] =
    await sql`select id from workspaces where is_default = true limit 1`;
  await sql`delete from meetings`;
  const [source] = await sql`insert into meetings
      (workspace_id, calendar_event_id, title, start_time, source, notes_generated)
    values (${ws.id}, 'e2e-wrong', 'Wrong meeting', ${AT(9)}, 'calendar', '## Recorded notes')
    returning id`;
  const [target] = await sql`insert into meetings
      (workspace_id, calendar_event_id, title, start_time, source)
    values (${ws.id}, 'e2e-right', 'Right meeting', ${AT(10)}, 'calendar')
    returning id`;
  await sql.end();
  return { sourceId: source.id, targetId: target.id };
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use password" }).click();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

test("generated notes can be moved from a meeting's detail page to another meeting", async ({
  page,
}) => {
  const { sourceId, targetId } = await seed();
  await login(page);
  await page.goto(`/meetings/${sourceId}`);

  await page.getByRole("button", { name: "Move…" }).click();
  const picker = page.locator(".move-notes-picker");
  const select = picker.locator("select");
  await expect
    .poll(async () => await select.locator("option").count())
    .toBeGreaterThan(1);
  // The source never offers itself as a target.
  await expect(select.locator("option", { hasText: "Wrong meeting" })).toHaveCount(0);
  const value = await select
    .locator("option", { hasText: "Right meeting" })
    .getAttribute("value");
  await select.selectOption(value!);

  // Editing the generated notes debounces an autosave; Move stays disabled until
  // that PATCH has landed, so the edit can't be written back onto the source.
  const moveBtn = picker.getByRole("button", { name: "Move notes" });
  await expect(moveBtn).toBeEnabled();
  await page.locator(".nsec-body").last().locator(".ProseMirror").click();
  await page.keyboard.type(" edited");
  await expect(moveBtn).toBeDisabled();
  await expect(moveBtn).toBeEnabled();

  const moved = page.waitForResponse(
    (r) => r.url().includes("/move-notes") && r.request().method() === "POST",
  );
  await picker.getByRole("button", { name: "Move notes" }).click();
  expect((await moved).status()).toBe(200);

  // Lands on the target, which now carries the generated notes.
  await page.waitForURL(`**/meetings/${targetId}`);
  await expect(page.getByRole("button", { name: "Generated notes" })).toBeVisible();
  await expect(page.locator(".nsec-body").last()).toContainText("Recorded notes");

  // And the source no longer has a Generated notes section at all.
  await page.goto(`/meetings/${sourceId}`);
  await expect(page.getByRole("button", { name: "Generated notes" })).toHaveCount(0);
});
