import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_PASSWORD } from "./constants";

const AT = "2021-04-06 15:00:00+00";

// Three attendees: one the workspace knows and the calendar named differently,
// one it knows with no calendar name at all (the case that showed an address),
// and one it doesn't know.
async function seed(): Promise<string> {
  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  const [ws] = await sql`select id from workspaces where is_default = true limit 1`;
  await sql`delete from meetings`;
  await sql`delete from people`;
  await sql`insert into people (workspace_id, name, email) values
    (${ws.id}, 'Dana Whitfield', 'dana@example.com'),
    (${ws.id}, 'Priya Raghunathan', 'p.raghunathan@example.com')`;
  const attendees = JSON.stringify([
    { name: "D. Whitfield", email: "dana@example.com" },
    { email: "p.raghunathan@example.com" },
    { email: "stranger@example.com" },
  ]);
  const [m] = await sql`insert into meetings
      (workspace_id, calendar_event_id, title, start_time, source, attendees)
    values (${ws.id}, 'e2e-att', 'Roster check', ${AT}, 'calendar', ${attendees}::jsonb)
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

test("a known attendee shows their People name, not an address", async ({ page }) => {
  const id = await seed();
  await login(page);
  await page.goto(`/meetings/${id}`);
  await page.waitForSelector(".attendees");

  // Collapsed line: the People name wins over the calendar's, and stands in
  // where the calendar sent no name at all.
  const label = page.locator(".attendees-label");
  await expect(label).toContainText("Dana Whitfield");
  await expect(label).toContainText("Priya Raghunathan");
  await expect(label).not.toContainText("D. Whitfield");
  await expect(label).not.toContainText("p.raghunathan");
  // An unknown attendee still falls back to the address's local part.
  await expect(label).toContainText("stranger");

  await page.locator(".attendees-toggle").click();
  const rows = page.locator(".attendee-row");
  await expect(rows).toHaveCount(3);

  // The name links to the person; the address is still there beside it.
  const dana = rows.nth(0);
  await expect(dana.locator(".attendee-name")).toHaveText("Dana Whitfield");
  await expect(dana.locator(".attendee-email")).toHaveText("dana@example.com");
  await expect(dana.locator("a.attendee-link")).toHaveAttribute(
    "href",
    /^\/people\//,
  );

  const priya = rows.nth(1);
  await expect(priya.locator(".attendee-name")).toHaveText("Priya Raghunathan");
  await expect(priya.locator(".attendee-email")).toHaveText(
    "p.raghunathan@example.com",
  );

  // Initials come from the People name too.
  await expect(priya.locator(".attendee-avatar")).toHaveText("PR");

  // The stranger is plain text, no link.
  const stranger = rows.nth(2);
  await expect(stranger.locator(".attendee-name")).toHaveText("stranger");
  await expect(stranger.locator("a")).toHaveCount(0);
});
