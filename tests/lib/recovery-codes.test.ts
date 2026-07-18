import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeRecoveryCode,
  countUnusedRecoveryCodes,
  generateRecoveryCodes,
} from "@/lib/webauthn";
import { resetDb } from "../helpers";
import { TEST_USER_ID } from "../constants";

beforeEach(async () => {
  await resetDb();
});

describe("recovery codes", () => {
  it("consumes a valid code exactly once (single-use)", async () => {
    const codes = await generateRecoveryCodes(TEST_USER_ID);
    expect(codes.length).toBeGreaterThan(0);
    expect(await countUnusedRecoveryCodes(TEST_USER_ID)).toBe(codes.length);

    expect(await consumeRecoveryCode(TEST_USER_ID, codes[0])).toBe(true);
    expect(await countUnusedRecoveryCodes(TEST_USER_ID)).toBe(codes.length - 1);

    // Same code again → rejected (already used).
    expect(await consumeRecoveryCode(TEST_USER_ID, codes[0])).toBe(false);
  });

  it("accepts codes regardless of case/formatting", async () => {
    const codes = await generateRecoveryCodes(TEST_USER_ID);
    const messy = codes[0].toLowerCase().replace("-", " ");
    expect(await consumeRecoveryCode(TEST_USER_ID, messy)).toBe(true);
  });

  it("rejects an unknown code", async () => {
    await generateRecoveryCodes(TEST_USER_ID);
    expect(await consumeRecoveryCode(TEST_USER_ID, "ZZZZZ-ZZZZZ")).toBe(false);
  });

  it("regenerating replaces the old set", async () => {
    const first = await generateRecoveryCodes(TEST_USER_ID);
    const second = await generateRecoveryCodes(TEST_USER_ID);
    // Old codes no longer work; count is full again.
    expect(await consumeRecoveryCode(TEST_USER_ID, first[0])).toBe(false);
    expect(await consumeRecoveryCode(TEST_USER_ID, second[0])).toBe(true);
  });
});
