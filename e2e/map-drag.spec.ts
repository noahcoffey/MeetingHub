import { test, expect, type Page } from "@playwright/test";
import postgres from "postgres";
import { E2E_DATABASE_URL, E2E_PASSWORD } from "./constants";

// Fixtures seeded straight into the DB: this spec is about dragging, and
// creating projects through the UI first would make it fail for other reasons.
const STAMP = Date.now();
const PINNED = `Drag me ${STAMP}`;
const OTHER = `Stay put ${STAMP}`;

test.beforeAll(async () => {
  const sql = postgres(E2E_DATABASE_URL, { max: 1 });
  try {
    const [ws] = await sql`select id from workspaces where is_default = true limit 1`;
    for (const name of [PINNED, OTHER]) {
      await sql`insert into projects (workspace_id, name) values (${ws.id}, ${name})`;
    }
  } finally {
    await sql.end();
  }
});

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use password" }).click();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Graph-space position, read from React Flow's own transform. Deliberately not
// boundingBox: the viewport pans and zooms, so screen pixels say nothing about
// where the node actually sits in the coordinate space that gets persisted.
async function graphPosition(page: Page, name: string) {
  return page
    .locator(".react-flow__node", { hasText: name })
    .evaluate((el) => {
      const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(
        (el as HTMLElement).style.transform,
      );
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    });
}

async function openMap(page: Page) {
  await page.goto("/map");
  await page.waitForSelector(".pg-node");
  // Let the relayout tween and the fitView that follows it finish.
  await page.waitForTimeout(1500);
}

test("a dragged project stays where it was put, across a reload", async ({
  page,
}) => {
  await login(page);
  await openMap(page);

  const node = page.locator(".pg-node", { hasText: PINNED });
  const before = (await graphPosition(page, PINNED))!;
  const neighbourBefore = (await graphPosition(page, OTHER))!;

  await test.step("drag it somewhere else", async () => {
    const saved = page.waitForResponse(
      (r) =>
        r.url().includes("/api/projects/") &&
        r.request().method() === "PATCH" &&
        r.ok(),
    );
    const box = (await node.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Two moves: React Flow needs one past its drag threshold before it starts.
    await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 - 40);
    await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2 - 150);
    await page.mouse.up();

    const body = (await saved).request().postDataJSON();
    expect(body.mapPosition.x).toEqual(expect.any(Number));
    expect(body.mapPosition.y).toEqual(expect.any(Number));
  });

  const after = (await graphPosition(page, PINNED))!;
  expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(80);

  await test.step("dragging one bubble does not move the others", async () => {
    const neighbourAfter = (await graphPosition(page, OTHER))!;
    expect(Math.abs(neighbourAfter.x - neighbourBefore.x)).toBeLessThan(1);
    expect(Math.abs(neighbourAfter.y - neighbourBefore.y)).toBeLessThan(1);
  });

  await test.step("it is still there after a reload", async () => {
    await openMap(page);
    const reloaded = (await graphPosition(page, PINNED))!;
    // Same graph space, so the coordinates must match, not merely look similar.
    expect(Math.abs(reloaded.x - after.x)).toBeLessThan(1);
    expect(Math.abs(reloaded.y - after.y)).toBeLessThan(1);
  });

  await test.step("Tidy leaves a hand-placed bubble alone", async () => {
    const held = (await graphPosition(page, PINNED))!;
    await page.getByRole("button", { name: "Tidy" }).click();
    await page.waitForTimeout(1200);
    const afterTidy = (await graphPosition(page, PINNED))!;
    expect(Math.abs(afterTidy.x - held.x)).toBeLessThan(1);
    expect(Math.abs(afterTidy.y - held.y)).toBeLessThan(1);
  });

  // Centring is detected by hand — two clicks on one bubble inside 400ms — and
  // a drag ends in a mouseup on that same bubble. Two quick drags must not be
  // mistaken for that gesture and throw the board into focus mode.
  await test.step("dragging twice in quick succession does not centre", async () => {
    const drag = async (dx: number, dy: number) => {
      const box = (await page.locator(".pg-node", { hasText: PINNED }).boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + dx / 2, cy + dy / 2);
      await page.mouse.move(cx + dx, cy + dy);
      await page.mouse.up();
    };
    await drag(70, 50);
    await drag(-70, -50);
    await expect(page.locator(".mapx.is-overview")).toBeVisible();
    await expect(page.locator(".pg-node.centre")).toHaveCount(0);
  });

  await test.step("Reset position hands it back to the layout", async () => {
    await page.locator(".pg-node", { hasText: PINNED }).click();
    await expect(page.locator(".mapx-panel-title")).toHaveText(PINNED);
    await expect(page.locator(".mapx-panel-meta")).toContainText("placed by hand");
    const cleared = page.waitForResponse(
      (r) =>
        r.url().includes("/api/projects/") &&
        r.request().method() === "PATCH" &&
        r.ok(),
    );
    await page.getByRole("button", { name: "Reset position" }).click();
    expect((await cleared).request().postDataJSON().mapPosition).toBeNull();
    await expect(page.locator(".mapx-panel-meta")).not.toContainText(
      "placed by hand",
    );
  });
});
