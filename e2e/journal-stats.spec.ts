import { test, expect, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "./constants";

async function login(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use password" }).click();
  await page.getByLabel("Password").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

// Wait for the next journal-entry PATCH (the debounced meta autosave) to land.
function waitForMetaSave(page: Page) {
  return page.waitForResponse(
    (r) =>
      r.url().includes("/api/journal-entries/") &&
      r.request().method() === "PATCH" &&
      r.ok(),
  );
}

test("journal stats: create a custom stat and log values that persist", async ({
  page,
}) => {
  await login(page);

  // Unique name so re-runs never collide with the active-name unique index.
  const statName = `E2E Sleep ${Date.now()}`;

  // Stat names live in <input> value attributes, so assert on values, not text.
  const statNames = () =>
    page
      .locator("input.stat-name")
      .evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

  await test.step("the seeded defaults render and a Number stat can be added", async () => {
    await page.goto("/settings/journal-stats");
    await expect(
      page.getByRole("heading", { name: "Journal stats" }),
    ).toBeVisible();
    // Migration-seeded defaults.
    await expect(page.locator("input.stat-name").first()).toBeVisible();
    expect(await statNames()).toContain("Productivity");

    await page.getByPlaceholder(/New stat name/).fill(statName);
    await page.getByLabel("Stat type").selectOption("number");
    const created = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/journal-stats") &&
        r.request().method() === "POST" &&
        r.ok(),
    );
    await page.getByRole("button", { name: "Add stat" }).click();
    await created;
    await expect
      .poll(async () => await statNames())
      .toContain(statName);
  });

  // Log on a fixed historical day so only this test touches that entry.
  const journalUrl = "/journal?date=2020-02-10";

  await test.step("the stat appears on the journal panel and autosaves", async () => {
    await page.goto(journalUrl);

    // The custom Number field shows up, keyed by its label.
    const numberField = page
      .locator(".meta-field", { hasText: statName })
      .locator("input.meta-number");
    await expect(numberField).toBeVisible();

    // A scale stat (Productivity) autosaves in-session.
    const prodField = page.locator(".meta-field", { hasText: "Productivity" });
    const high = prodField.getByRole("button", { name: "High", exact: true });
    if ((await high.getAttribute("aria-pressed")) !== "true") {
      const s = waitForMetaSave(page);
      await high.click();
      await s;
    }
    await expect(high).toHaveAttribute("aria-pressed", "true");

    // The number value autosaves.
    const s2 = waitForMetaSave(page);
    await numberField.fill("7");
    await numberField.blur();
    await s2;
  });

  await test.step("the values survive a reload", async () => {
    await page.reload();
    const numberField = page
      .locator(".meta-field", { hasText: statName })
      .locator("input.meta-number");
    await expect(numberField).toHaveValue("7");
    const high = page
      .locator(".meta-field", { hasText: "Productivity" })
      .getByRole("button", { name: "High", exact: true });
    await expect(high).toHaveAttribute("aria-pressed", "true");
  });

  await test.step("the custom stat renders a chart on Reports", async () => {
    await page.goto("/reports?days=90");
    await expect(
      page.locator(".report-card", { hasText: statName }),
    ).toBeVisible();
  });
});
