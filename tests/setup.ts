import { afterAll } from "vitest";

// src/db caches its postgres client on globalThis; close it so the worker
// doesn't hold sockets open after the run.
afterAll(async () => {
  const g = globalThis as unknown as {
    pgClient?: { end: (opts?: { timeout?: number }) => Promise<void> };
  };
  await g.pgClient?.end({ timeout: 5 });
});
