import { defineConfig, devices } from "@playwright/test";
import {
  E2E_AUTH_SECRET,
  E2E_BASE_URL,
  E2E_DATABASE_URL,
  E2E_PORT,
} from "./e2e/constants";

// E2E drives a real `next dev` server (own port, own database) through Chromium.
// The meetinghub_e2e DB is created/migrated/seeded by `tsx e2e/setup-db.ts`,
// chained ahead of `playwright test` in the test:e2e script. Next does not
// override already-set env vars, so DATABASE_URL/AUTH_SECRET below win over
// .env.local for the spawned server.
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  // Generous ceilings for cold CI runners, where next-dev compiles routes on
  // first hit; harmless locally (they're maxes, not fixed waits).
  timeout: 60_000,
  use: {
    baseURL: E2E_BASE_URL,
    trace: "on-first-retry",
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: `next dev -p ${E2E_PORT}`,
    url: `${E2E_BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: E2E_DATABASE_URL,
      AUTH_SECRET: E2E_AUTH_SECRET,
      NODE_ENV: "development",
    },
  },
});
