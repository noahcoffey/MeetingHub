import "server-only";

// In-memory login throttle. Sufficient for a single-user, single-container deploy:
// state resets on restart (fine — that only ever clears lockouts, never weakens a
// correct password) and there's just one process behind Traefik.

type Bucket = { fails: number; windowStart: number; lockedUntil: number };

const buckets = new Map<string, Bucket>();

const MAX_FAILS = 5; // per IP within the window before lockout
const WINDOW_MS = 15 * 60_000; // failures counted within this rolling window
const LOCK_MS = 15 * 60_000; // lockout duration once tripped
const GLOBAL_KEY = "__global__";
const GLOBAL_MAX_FAILS = 50; // backstop against IP-rotating / distributed attempts

type HeaderGetter = { get(name: string): string | null };

// How many trusted reverse proxies sit in front of the app. Each trusted proxy
// APPENDS the address it received from to X-Forwarded-For, so the real client IP
// is the entry `count` positions from the right. Everything to the left of that
// arrived from the client and is spoofable. Default 1 (a single proxy such as
// Traefik). Set TRUSTED_PROXY_COUNT=0 for a directly-exposed instance (no proxy)
// — then XFF/X-Real-IP are untrusted and per-IP throttling degrades to the
// global backstop. See SECURITY.md.
function trustedProxyCount(): number {
  const raw = process.env.TRUSTED_PROXY_COUNT;
  if (raw === undefined) return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

export function ipFromHeaders(h: HeaderGetter): string {
  const count = trustedProxyCount();
  if (count === 0) return "unknown"; // no trusted proxy → headers are spoofable
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const entries = xff
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (entries.length > 0) {
      const ip = entries[Math.max(0, entries.length - count)];
      if (ip) return ip;
    }
  }
  const real = h.get("x-real-ip");
  return real ? real.trim() : "unknown";
}

function remainingLock(key: string): number {
  const b = buckets.get(key);
  if (!b) return 0;
  const now = Date.now();
  return b.lockedUntil > now ? b.lockedUntil - now : 0;
}

// ms remaining until this IP (or the global backstop) is unlocked; 0 if not locked.
export function loginLockMs(ip: string): number {
  return Math.max(remainingLock(ip), remainingLock(GLOBAL_KEY));
}

function bump(key: string, max: number) {
  const now = Date.now();
  const b = buckets.get(key) ?? { fails: 0, windowStart: now, lockedUntil: 0 };
  if (now - b.windowStart > WINDOW_MS) {
    b.fails = 0;
    b.windowStart = now;
  }
  b.fails += 1;
  if (b.fails >= max) {
    b.lockedUntil = now + LOCK_MS;
    b.fails = 0;
    b.windowStart = now;
  }
  buckets.set(key, b);
}

export function recordLoginFailure(ip: string): void {
  bump(ip, MAX_FAILS);
  bump(GLOBAL_KEY, GLOBAL_MAX_FAILS);
}

export function recordLoginSuccess(ip: string): void {
  buckets.delete(ip);
}
