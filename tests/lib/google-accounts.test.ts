import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { googleAccounts, workspaces } from "@/db/schema";
import {
  deleteGoogleAccount,
  getRefreshToken,
  listGoogleAccounts,
  upsertGoogleAccount,
} from "@/lib/google-accounts";
import { makeWorkspace, resetDb } from "../helpers";
import { TEST_USER_ID } from "../constants";

beforeAll(() => {
  process.env.AUTH_SECRET ||= "test-auth-secret-for-google-accounts";
});

beforeEach(async () => {
  await resetDb();
});

describe("upsertGoogleAccount", () => {
  it("stores the refresh token encrypted, never plaintext", async () => {
    const acc = await upsertGoogleAccount({
      userId: TEST_USER_ID,
      email: "work@example.com",
      refreshToken: "1//super-secret-refresh",
      scope: "calendar.readonly",
    });
    // Safe shape carries no token.
    expect(Object.keys(acc)).not.toContain("refreshTokenEnc");
    const [row] = await db
      .select()
      .from(googleAccounts)
      .where(eq(googleAccounts.id, acc.id));
    expect(row.refreshTokenEnc).not.toContain("1//super-secret-refresh");
    expect(await getRefreshToken(acc.id)).toBe("1//super-secret-refresh");
  });

  it("updates the token on reconnect (unique by email)", async () => {
    const a = await upsertGoogleAccount({
      userId: TEST_USER_ID,
      email: "work@example.com",
      refreshToken: "old",
    });
    const b = await upsertGoogleAccount({
      userId: TEST_USER_ID,
      email: "work@example.com",
      refreshToken: "new",
    });
    expect(b.id).toBe(a.id);
    expect(await getRefreshToken(a.id)).toBe("new");
    expect((await listGoogleAccounts()).length).toBe(1);
  });

  it("supports multiple accounts", async () => {
    await upsertGoogleAccount({ userId: TEST_USER_ID, email: "work@example.com", refreshToken: "x" });
    await upsertGoogleAccount({ userId: TEST_USER_ID, email: "home@example.com", refreshToken: "y" });
    expect((await listGoogleAccounts()).map((a) => a.email)).toEqual([
      "home@example.com",
      "work@example.com",
    ]);
  });
});

describe("deleteGoogleAccount", () => {
  it("nulls a workspace's Google source (FK set null)", async () => {
    const acc = await upsertGoogleAccount({
      userId: TEST_USER_ID,
      email: "work@example.com",
      refreshToken: "x",
    });
    const wsId = await makeWorkspace("Alpha", { isDefault: true });
    await db
      .update(workspaces)
      .set({ googleAccountId: acc.id, googleCalendarId: "primary" })
      .where(eq(workspaces.id, wsId));

    await deleteGoogleAccount(acc.id);

    const [ws] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, wsId));
    expect(ws.googleAccountId).toBeNull();
    expect(await getRefreshToken(acc.id)).toBeNull();
  });
});
