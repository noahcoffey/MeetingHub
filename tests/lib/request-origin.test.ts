import { describe, expect, it } from "vitest";
import { requestOrigin } from "@/lib/request-origin";

function req(headers: Record<string, string>) {
  return { headers: new Headers(headers) };
}

describe("requestOrigin", () => {
  it("prefers x-forwarded-host + x-forwarded-proto (proxy deployment)", () => {
    expect(
      requestOrigin(
        req({
          host: "0.0.0.0:3000",
          "x-forwarded-host": "hub.example.com",
          "x-forwarded-proto": "https",
        }),
      ),
    ).toBe("https://hub.example.com");
  });

  it("uses the first value of comma-joined forwarded headers", () => {
    expect(
      requestOrigin(
        req({
          "x-forwarded-host": "hub.example.com, inner.proxy",
          "x-forwarded-proto": "https, http",
        }),
      ),
    ).toBe("https://hub.example.com");
  });

  it("falls back to the host header, assuming https for non-local hosts", () => {
    expect(requestOrigin(req({ host: "hub.example.com" }))).toBe(
      "https://hub.example.com",
    );
  });

  it("assumes http for localhost dev", () => {
    expect(requestOrigin(req({ host: "localhost:3000" }))).toBe(
      "http://localhost:3000",
    );
    expect(requestOrigin(req({ host: "127.0.0.1:3000" }))).toBe(
      "http://127.0.0.1:3000",
    );
  });

  it("defaults to localhost when no host headers exist", () => {
    expect(requestOrigin(req({}))).toBe("http://localhost:3000");
  });
});
