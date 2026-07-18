import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ipFromHeaders,
  loginLockMs,
  recordLoginFailure,
  recordLoginSuccess,
} from "@/lib/login-throttle";

// The throttle keeps module-level in-memory state and reads Date.now(). Fake
// timers + a base time advanced by an hour per test isolate cases (any prior
// lock/window is stale by the next test) without needing a reset hook.
let base = Date.UTC(2026, 0, 1, 0, 0, 0);
beforeEach(() => {
  vi.useFakeTimers();
  base += 60 * 60_000;
  vi.setSystemTime(base);
});
afterEach(() => vi.useRealTimers());

function headers(map: Record<string, string>) {
  return { get: (n: string) => map[n.toLowerCase()] ?? null };
}

describe("ipFromHeaders", () => {
  it("trusts only the rightmost X-Forwarded-For entry", () => {
    expect(
      ipFromHeaders(headers({ "x-forwarded-for": "1.1.1.1, 2.2.2.2, 3.3.3.3" })),
    ).toBe("3.3.3.3");
  });
  it("falls back to x-real-ip, then 'unknown'", () => {
    expect(ipFromHeaders(headers({ "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(ipFromHeaders(headers({}))).toBe("unknown");
  });
});

describe("per-IP throttle", () => {
  it("locks after 5 failures and a success clears it", () => {
    const ip = "10.0.0.1";
    for (let i = 0; i < 4; i++) recordLoginFailure(ip);
    expect(loginLockMs(ip)).toBe(0);
    recordLoginFailure(ip); // the 5th trips the lock
    expect(loginLockMs(ip)).toBeGreaterThan(0);
    recordLoginSuccess(ip);
    expect(loginLockMs(ip)).toBe(0);
  });

  it("unlocks once the lock duration elapses", () => {
    const ip = "10.0.0.2";
    for (let i = 0; i < 5; i++) recordLoginFailure(ip);
    expect(loginLockMs(ip)).toBeGreaterThan(0);
    vi.advanceTimersByTime(15 * 60_000 + 1000);
    expect(loginLockMs(ip)).toBe(0);
  });

  it("forgets failures once the rolling window passes", () => {
    const ip = "10.0.0.3";
    for (let i = 0; i < 4; i++) recordLoginFailure(ip);
    vi.advanceTimersByTime(15 * 60_000 + 1000); // window expires
    for (let i = 0; i < 4; i++) recordLoginFailure(ip); // fresh window
    expect(loginLockMs(ip)).toBe(0); // 4 < 5, never tripped
  });
});

describe("global backstop", () => {
  it("locks globally after many failures across rotating IPs", () => {
    for (let i = 0; i < 50; i++) recordLoginFailure(`proxy-${i}`);
    // Even a brand-new IP is now locked by the global backstop.
    expect(loginLockMs("never-seen-before")).toBeGreaterThan(0);
  });
});
