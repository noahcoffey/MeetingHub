import "server-only";
import { lookup } from "node:dns/promises";
import net from "node:net";

// SSRF protection for server-side fetches of user-supplied URLs (the ICS feed).
// Two layers: a synchronous shape check (scheme + obviously-internal hosts) used
// at save time, and a DNS-resolving check + redirect-aware fetch used at fetch
// time — which also defends against DNS rebinding and redirect-to-internal.

const MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const DEFAULT_TIMEOUT_MS = 15_000;

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = n * 256 + o;
  }
  return n >>> 0;
}

function inCidr(n: number, base: string, bits: number): boolean {
  const b = ipv4ToInt(base);
  if (b === null) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return ((n & mask) >>> 0) === ((b & mask) >>> 0);
}

function isBlockedIpv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable → block
  return (
    inCidr(n, "0.0.0.0", 8) || // "this" network
    inCidr(n, "10.0.0.0", 8) || // private
    inCidr(n, "100.64.0.0", 10) || // CGNAT
    inCidr(n, "127.0.0.0", 8) || // loopback
    inCidr(n, "169.254.0.0", 16) || // link-local (cloud metadata)
    inCidr(n, "172.16.0.0", 12) || // private
    inCidr(n, "192.0.0.0", 24) || // IETF protocol assignments
    inCidr(n, "192.168.0.0", 16) || // private
    inCidr(n, "198.18.0.0", 15) || // benchmarking
    inCidr(n, "224.0.0.0", 4) || // multicast
    inCidr(n, "240.0.0.0", 4) // reserved
  );
}

function isBlockedIpv6(ip: string): boolean {
  const s = ip.toLowerCase();
  if (s === "::1" || s === "::") return true;
  // loopback, unspecified, link-local (fe80::/10), unique-local (fc00::/7)
  if (s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb"))
    return true;
  if (s.startsWith("fc") || s.startsWith("fd")) return true;
  // IPv4-mapped ::ffff:a.b.c.d
  const m = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (m) return isBlockedIpv4(m[1]);
  return false;
}

export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isBlockedIpv4(ip);
  if (net.isIPv6(ip)) return isBlockedIpv6(ip);
  return true; // not a valid IP literal → block
}

// URL hostname for an IPv6 literal keeps its brackets ("[::1]"); strip them so
// net.isIP / isBlockedIp see the bare address.
function bareHost(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}

// Synchronous shape check for save-time validation. Rejects non-http(s) schemes
// and obviously-internal hosts (localhost, *.internal/.local, literal private IPs).
// Does NOT resolve DNS — that happens at fetch time (safeFetchText).
export function assertUrlShape(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BlockedUrlError("only http(s) URLs are allowed");
  }
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    throw new BlockedUrlError("internal hosts are not allowed");
  }
  const ipHost = bareHost(host);
  if (net.isIP(ipHost) && isBlockedIp(ipHost)) {
    throw new BlockedUrlError("private/reserved IPs are not allowed");
  }
  return url;
}

// Resolve the host and ensure every returned address is public (DNS-rebind guard).
async function assertResolvesPublic(url: URL): Promise<void> {
  const host = bareHost(url.hostname);
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new BlockedUrlError("private/reserved IP");
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new BlockedUrlError("host does not resolve");
  }
  if (addrs.length === 0) throw new BlockedUrlError("host does not resolve");
  for (const a of addrs) {
    if (isBlockedIp(a.address)) {
      throw new BlockedUrlError("host resolves to a private/reserved address");
    }
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const len = Number(res.headers.get("content-length") ?? "0");
  if (len > maxBytes) throw new BlockedUrlError("response too large");
  const body = res.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new BlockedUrlError("response too large");
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks).toString("utf8");
}

// SSRF-safe GET of a user-supplied URL: validates scheme + resolved IPs on every
// hop (manual redirects), enforces a timeout and a body-size cap.
export async function safeFetchText(
  rawUrl: string,
  opts: {
    maxBytes?: number;
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<string> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let current = assertUrlShape(rawUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertResolvesPublic(current);
      const res = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: opts.headers,
        cache: "no-store",
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new BlockedUrlError("redirect without a location");
        current = assertUrlShape(new URL(loc, current).toString());
        continue;
      }
      if (!res.ok) throw new Error(`fetch failed with status ${res.status}`);
      return await readCapped(res, maxBytes);
    }
    throw new BlockedUrlError("too many redirects");
  } finally {
    clearTimeout(timer);
  }
}
