import { describe, expect, it } from "vitest";
import { safeCallbackUrl } from "@/lib/safe-redirect";

describe("safeCallbackUrl", () => {
  it("keeps same-origin relative paths", () => {
    expect(safeCallbackUrl("/tasks")).toBe("/tasks");
    expect(safeCallbackUrl("/settings/tokens?x=1")).toBe("/settings/tokens?x=1");
  });

  it("falls back to / for empty/missing input", () => {
    expect(safeCallbackUrl(null)).toBe("/");
    expect(safeCallbackUrl(undefined)).toBe("/");
    expect(safeCallbackUrl("")).toBe("/");
  });

  it("rejects off-site and protocol-relative targets", () => {
    for (const u of [
      "https://evil.com",
      "http://evil.com",
      "//evil.com",
      "/\\evil.com",
      "javascript:alert(1)",
      "mailto:x@y.com",
      "evil.com",
    ]) {
      expect(safeCallbackUrl(u), u).toBe("/");
    }
  });
});
