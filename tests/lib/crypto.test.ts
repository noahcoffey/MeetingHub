import { beforeAll, describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

beforeAll(() => {
  process.env.AUTH_SECRET ||= "test-auth-secret-for-crypto-roundtrip";
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value", () => {
    const secret = "1//refresh-token-abc.def_GHI";
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("rejects a tampered ciphertext", () => {
    const enc = encryptSecret("payload");
    const [iv, tag, data] = enc.split(".");
    // Flip a byte in the ciphertext → GCM auth fails.
    const bad = Buffer.from(data, "base64");
    bad[0] ^= 0xff;
    const tampered = [iv, tag, bad.toString("base64")].join(".");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("rejects a malformed payload", () => {
    expect(() => decryptSecret("nope")).toThrow();
  });
});
