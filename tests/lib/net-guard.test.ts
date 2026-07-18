import { describe, expect, it } from "vitest";
import { assertUrlShape, isBlockedIp, BlockedUrlError } from "@/lib/net-guard";

describe("assertUrlShape", () => {
  it("allows public http(s) URLs", () => {
    expect(assertUrlShape("https://example.com/cal.ics").hostname).toBe(
      "example.com",
    );
    expect(assertUrlShape("http://calendar.example.org/feed").protocol).toBe(
      "http:",
    );
    // A public literal IP is fine at the shape stage.
    expect(assertUrlShape("https://8.8.8.8/x").hostname).toBe("8.8.8.8");
  });

  it("rejects non-http(s) schemes", () => {
    for (const u of [
      "ftp://example.com",
      "file:///etc/passwd",
      "gopher://x",
      "javascript:alert(1)",
    ]) {
      expect(() => assertUrlShape(u)).toThrow(BlockedUrlError);
    }
  });

  it("rejects internal / private-literal hosts", () => {
    for (const u of [
      "http://localhost/x",
      "http://app.localhost/x",
      "http://foo.internal/x",
      "http://printer.local/x",
      "http://127.0.0.1/x",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.5/x",
      "http://192.168.1.1/x",
      "http://172.16.4.4/x",
      "http://[::1]/x",
    ]) {
      expect(() => assertUrlShape(u)).toThrow(BlockedUrlError);
    }
  });

  it("rejects garbage", () => {
    expect(() => assertUrlShape("not a url")).toThrow(BlockedUrlError);
  });
});

describe("isBlockedIp", () => {
  it("blocks private / loopback / link-local / reserved", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "240.0.0.1",
      "::1",
      "fe80::1",
      "fc00::1",
      "fd12:3456::1",
      "::ffff:127.0.0.1",
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("blocks anything that isn't a valid IP literal", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("999.999.999.999")).toBe(true);
  });
});
