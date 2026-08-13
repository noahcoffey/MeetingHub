import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_PASSWORD } from "./constants";

// Fixtures are seeded straight into the e2e DB rather than clicked into
// existence: this spec is about the relations UI, and driving project/meeting
// creation through the UI first would make it fail for unrelated reasons.
// Names carry a run stamp so repeat runs never collide.
const STAMP = Date.now();
const HUB = `E2E Billing ${STAMP}`;
const NEIGHBOUR = `E2E Portal ${STAMP}`;
const BLOCKER = `E2E Vendors ${STAMP}`;
const MEETING = `E2E Billing weekly ${STAMP}`;

test.beforeAll(async () => {
  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  try {
    const [ws] = await sql`select id from workspaces where is_default = true limit 1`;
    const mk = async (name: string) => {
      const [row] = await sql`
        insert into projects (workspace_id, name) values (${ws.id}, ${name})
        returning id`;
      return row.id as string;
    };
    const hub = await mk(HUB);
    const neighbour = await mk(NEIGHBOUR);
    const blocker = await mk(BLOCKER);
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    const [meeting] = await sql`
      insert into meetings (workspace_id, title, start_time, end_time, source, project_id, calendar_event_id)
      values (${ws.id}, ${MEETING}, ${start}, ${new Date(start.getTime() + 3_600_000)},
              'manual', ${hub}, ${`e2e-rel-${STAMP}`})
      returning id`;
    await sql`
      insert into project_relations (from_id, to_id, kind, created_in_meeting_id)
      values (${hub}, ${neighbour}, 'related', ${meeting.id})`;
    await sql`
      insert into project_relations (from_id, to_id, kind)
      values (${blocker}, ${hub}, 'blocks')`;
  } finally {
    await sql.end();
  }
});

// Hub tab labels ("Map", "Meetings") are also main-nav labels, so tab clicks
// must be scoped to the tab bar or they land on the sidebar link instead.
function hubTab(page: Page, label: string) {
  return page.locator(".hub-tabs").getByRole("link", { name: new RegExp(`^${label}`) });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use password" }).click();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// The whole point of the feature: something adjacent comes up mid-meeting, it
// gets a home in one keystroke, and it's still there afterwards — on the map,
// on the parked shelf, and in search.
test("capture a tangent from a meeting, then find it on the map", async ({
  page,
}) => {
  await login(page);

  const idea = `Vendor API rework ${Date.now()}`;

  await test.step("capture it from the meeting rail", async () => {
    await page.goto("/projects");
    await page.locator(".project-row-name", { hasText: HUB }).first().click();
    await hubTab(page, "Meetings").click();
    await page
      .getByRole("link", { name: MEETING })
      .first()
      .click();

    const rail = page.locator(".rail-section", {
      has: page.getByRole("button", { name: /Related projects/ }),
    });
    await expect(rail).toBeVisible();
    // The seeded edge from the fixture is already there.
    await expect(rail.getByText(NEIGHBOUR)).toBeVisible();

    const input = rail.getByPlaceholder("Name something that came up…");
    await input.fill(idea);
    const created = page.waitForResponse(
      (r) =>
        r.url().includes("/api/project-relations/capture") &&
        r.request().method() === "POST",
    );
    await input.press("Enter");
    expect((await created).status()).toBe(201);
    await expect(rail.getByText(idea)).toBeVisible();
  });

  await test.step("it shows on the project map as a parked node", async () => {
    await page.goto("/projects");
    await page.locator(".project-row-name", { hasText: HUB }).first().click();
    await hubTab(page, "Map").click();
    const node = page.locator(".pmap-node", { hasText: idea });
    await expect(node).toBeVisible();
    await expect(node).toHaveClass(/parked/);
    // The blocks edge from the fixture draws an arrowhead.
    await expect(page.locator(".pmap-edge.kind-blocks")).toHaveCount(1);
  });

  await test.step("and on the standalone workspace map from the nav", async () => {
    // The hub tab bar is a <nav> too, so target the sidebar specifically.
    await page.locator(".side-nav").getByRole("link", { name: "Map" }).click();
    await expect(page).toHaveURL(/\/map$/);
    await page.waitForSelector(".mapx-canvas");
    // Default is the whole ecosystem, unconnected projects included.
    await expect(page.locator(".mapx.is-overview")).toBeVisible();
    for (const name of [HUB, NEIGHBOUR, BLOCKER, idea]) {
      await expect(page.locator(".mapx-node", { hasText: name })).toBeVisible();
    }
    // Selecting in the overview opens the panel WITHOUT re-centring, so the
    // board stays put while you inspect or connect something.
    const url = page.url();
    await page.locator(".mapx-node", { hasText: HUB }).locator(".mapx-node-label").click();
    await expect(page.locator(".mapx-panel-title")).toHaveText(HUB);
    await expect(page.locator(".mapx.is-overview")).toBeVisible();
    // Centring is the explicit action, and still no navigation.
    await page.getByRole("button", { name: "Centre on this" }).click();
    await expect(page.locator(".mapx.is-overview")).toHaveCount(0);
    await expect(page.locator(".mapx-node.focus")).toContainText(HUB);
    expect(page.url()).toBe(url);
    await page.getByRole("button", { name: "‹ Everything" }).click();
    await expect(page.locator(".mapx.is-overview")).toBeVisible();
  });

  await test.step("connections can be drawn without a drag", async () => {
    // Click the handle, then click the target — the connector must not depend
    // on landing a drag on a small hit area.
    const source = page.locator(".mapx-node", { hasText: BLOCKER });
    await source.hover();
    await source.locator(".mapx-crosshair").click();
    await expect(page.locator(".mapx-linking")).toBeVisible();
    const created = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/project-relations") &&
        r.request().method() === "POST",
    );
    await page
      .locator(".mapx-node", { hasText: NEIGHBOUR })
      .locator(".mapx-node-label")
      .click();
    expect((await created).status()).toBe(201);
    // The new edge lands on the board immediately, with no reload.
    await expect(page.locator(".mapx-linking")).toHaveCount(0);
    await page
      .locator(".mapx-node", { hasText: NEIGHBOUR })
      .locator(".mapx-node-label")
      .click();
    await expect(
      page.locator(".mapx-rel-row", { hasText: BLOCKER }),
    ).toBeVisible();
  });

  // The active list renders names inside a link whose accessible name also
  // carries meeting/deadline metadata, so match the name cell, not the link.
  const activeRow = () => page.locator(".project-row-name", { hasText: idea });

  await test.step("it sits on the parked shelf, not the active list", async () => {
    await page.goto("/projects");
    await expect(activeRow()).toHaveCount(0);
    await page.goto("/projects?view=parked");
    await expect(page.getByRole("link", { name: idea })).toBeVisible();
  });

  await test.step("promoting it moves it into the active list", async () => {
    const row = page.locator(".hidden-row", { hasText: idea });
    // The shelf drops the row optimistically, so waiting on the row alone would
    // race the PATCH — navigate only once the server has actually promoted it.
    const promoted = page.waitForResponse(
      (r) =>
        r.url().includes("/api/projects/") && r.request().method() === "PATCH",
    );
    await row.getByRole("button", { name: "Promote" }).click();
    await expect(row).toHaveCount(0);
    expect((await promoted).ok()).toBe(true);
    await page.goto("/projects");
    await expect(activeRow()).toBeVisible();
  });
});
