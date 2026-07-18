import { defineConfig } from "vitest/config";
import path from "node:path";
import { TEST_DATABASE_URL } from "./tests/constants";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // The lib modules guard against client-component imports; in the test
      // runner (plain node) the guard package itself throws, so stub it out.
      "server-only": path.resolve(__dirname, "tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    globalSetup: "./tests/global-setup.ts",
    setupFiles: ["./tests/setup.ts"],
    // All test files share one test database — run them one at a time.
    fileParallelism: false,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      APP_TIMEZONE: "America/New_York",
    },
    coverage: {
      provider: "v8",
      // Scope to server logic exercised by this (integration/unit) suite. UI
      // components are covered by the Playwright E2E, which v8 doesn't
      // instrument, so including them here would understate real coverage.
      include: ["src/lib/**", "src/app/api/**"],
      reporter: ["text", "html", "json-summary"],
      // A floor to catch regressions, set just below current levels. Ratchet up
      // as coverage grows; never lower to make a red build pass.
      thresholds: {
        statements: 30,
        branches: 27,
        functions: 34,
        lines: 31,
      },
    },
  },
});
