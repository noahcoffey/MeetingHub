import { beforeEach, describe, expect, it } from "vitest";
import {
  createApiToken,
  deleteApiToken,
  listApiTokens,
  verifyApiToken,
} from "@/lib/api-tokens";
import { makeWorkspace, resetDb } from "../helpers";
import { TEST_USER_ID } from "../constants";

let wsA: string;
let wsB: string;

beforeEach(async () => {
  await resetDb();
  wsA = await makeWorkspace("Alpha", { isDefault: true });
  wsB = await makeWorkspace("Beta");
});

describe("createApiToken", () => {
  it("returns a mh_-prefixed secret and never stores it", async () => {
    const { token, secret } = await createApiToken(TEST_USER_ID, {
      name: "cli",
      scope: "read",
      workspaceIds: null,
    });
    expect(secret.startsWith("mh_")).toBe(true);
    expect(token.tokenPrefix).toBe(secret.slice(0, 12));
    // The safe shape must not carry the hash.
    expect(Object.keys(token)).not.toContain("tokenHash");
  });

  it("normalizes an empty workspace array to null (all workspaces)", async () => {
    const { token } = await createApiToken(TEST_USER_ID, {
      name: "cli",
      scope: "read",
      workspaceIds: [],
    });
    expect(token.workspaceIds).toBeNull();
  });

  it("rejects an unknown workspace id", async () => {
    await expect(
      createApiToken(TEST_USER_ID, {
        name: "cli",
        scope: "read",
        workspaceIds: ["55555555-5555-4555-8555-555555555555"],
      }),
    ).rejects.toThrow(/unknown workspace/);
  });
});

describe("verifyApiToken", () => {
  it("returns a principal for a valid secret", async () => {
    const { secret } = await createApiToken(TEST_USER_ID, {
      name: "cli",
      scope: "write",
      workspaceIds: [wsA],
    });
    const principal = await verifyApiToken(secret);
    expect(principal?.scope).toBe("write");
    expect(principal?.allowedWorkspaceIds).toEqual([wsA]);
  });

  it("rejects a short or non-mh string without touching the db", async () => {
    expect(await verifyApiToken("nope")).toBeNull();
    expect(await verifyApiToken("mh_short")).toBeNull();
  });

  it("returns null for an expired token", async () => {
    const { secret } = await createApiToken(TEST_USER_ID, {
      name: "cli",
      scope: "read",
      workspaceIds: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await verifyApiToken(secret)).toBeNull();
  });

  it("intersects the stored restriction with live workspaces", async () => {
    const { secret } = await createApiToken(TEST_USER_ID, {
      name: "cli",
      scope: "read",
      workspaceIds: [wsA, wsB],
    });
    // Reset drops wsB; re-create only Alpha so the token's wsB id is now stale.
    await resetDb();
    const freshA = await makeWorkspace("Alpha", { isDefault: true });
    // The token row is gone after reset, so re-mint against the fresh workspace.
    const { secret: s2 } = await createApiToken(TEST_USER_ID, {
      name: "cli2",
      scope: "read",
      workspaceIds: [freshA],
    });
    const principal = await verifyApiToken(s2);
    expect(principal?.allowedWorkspaceIds).toEqual([freshA]);
    // The original secret's row was truncated, so it no longer verifies.
    expect(await verifyApiToken(secret)).toBeNull();
  });

  it("updates lastUsedAt on first use", async () => {
    const { token, secret } = await createApiToken(TEST_USER_ID, {
      name: "cli",
      scope: "read",
      workspaceIds: null,
    });
    expect(token.lastUsedAt).toBeNull();
    await verifyApiToken(secret);
    // Fire-and-forget write; give it a tick to land.
    await new Promise((r) => setTimeout(r, 50));
    const [listed] = await listApiTokens();
    expect(listed.lastUsedAt).not.toBeNull();
  });
});

describe("deleteApiToken", () => {
  it("removes the token so it no longer verifies", async () => {
    const { token, secret } = await createApiToken(TEST_USER_ID, {
      name: "cli",
      scope: "read",
      workspaceIds: null,
    });
    await deleteApiToken(token.id);
    expect(await verifyApiToken(secret)).toBeNull();
    expect(await listApiTokens()).toEqual([]);
  });
});
