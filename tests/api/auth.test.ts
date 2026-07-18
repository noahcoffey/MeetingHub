import { beforeEach, describe, expect, it } from "vitest";
import { GET as me } from "@/app/api/v1/me/route";
import { GET as listWorkspaces } from "@/app/api/v1/workspaces/route";
import { GET as listTasks, POST as createTask } from "@/app/api/v1/tasks/route";
import { GET as getTask } from "@/app/api/v1/tasks/[id]/route";
import { GET as listNotes } from "@/app/api/v1/notes/route";
import { call, makeToken, makeWorkspace, resetDb } from "../helpers";

let wsA: string;
let wsB: string;

beforeEach(async () => {
  await resetDb();
  wsA = await makeWorkspace("Alpha", { isDefault: true });
  wsB = await makeWorkspace("Beta");
});

describe("bearer authentication", () => {
  it("rejects a missing token", async () => {
    const res = await call(me);
    expect(res.status).toBe(401);
    expect(res.json.error).toBe("unauthorized");
  });

  it("rejects a non-mh token", async () => {
    const res = await call(me, { bearer: "garbage-value-here" });
    expect(res.status).toBe(401);
  });

  it("rejects a well-formed but unknown mh token", async () => {
    const res = await call(me, {
      bearer: "mh_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    });
    expect(res.status).toBe(401);
  });

  it("rejects an expired token", async () => {
    const token = await makeToken({
      scope: "read",
      expiresAt: new Date(Date.now() - 3600_000),
    });
    const res = await call(me, { bearer: token });
    expect(res.status).toBe(401);
  });

  it("accepts a valid token and reports its scope", async () => {
    const token = await makeToken({ scope: "write" });
    const res = await call(me, { bearer: token });
    expect(res.status).toBe(200);
    expect(res.json.scope).toBe("write");
    expect(res.json.allWorkspaces).toBe(true);
  });

  it("stops accepting a token once it is deleted", async () => {
    const token = await makeToken({ scope: "read" });
    expect((await call(me, { bearer: token })).status).toBe(200);
    await resetDb(); // wipes api_tokens
    await makeWorkspace("Alpha", { isDefault: true });
    expect((await call(me, { bearer: token })).status).toBe(401);
  });
});

describe("scope enforcement", () => {
  it("blocks writes with a read-only token", async () => {
    const token = await makeToken({ scope: "read" });
    const res = await call(createTask, {
      method: "POST",
      bearer: token,
      query: { workspace: wsA },
      body: { content: "x" },
    });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe("token is read-only");
  });

  it("allows writes with a write token", async () => {
    const token = await makeToken({ scope: "write" });
    const res = await call(createTask, {
      method: "POST",
      bearer: token,
      query: { workspace: wsA },
      body: { content: "do the thing" },
    });
    expect(res.status).toBe(201);
  });
});

describe("workspace resolution", () => {
  it("requires ?workspace for a multi-workspace token", async () => {
    const token = await makeToken({ scope: "read" });
    const res = await call(listTasks, { bearer: token });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("workspace query param required");
  });

  it("defaults to the sole workspace for a single-workspace token", async () => {
    const token = await makeToken({ scope: "read", workspaceIds: [wsB] });
    const res = await call(listTasks, { bearer: token });
    expect(res.status).toBe(200);
    expect(res.json.items).toEqual([]);
  });

  it("rejects a workspace outside the token's restriction", async () => {
    const token = await makeToken({ scope: "read", workspaceIds: [wsB] });
    const res = await call(listTasks, {
      bearer: token,
      query: { workspace: wsA },
    });
    expect(res.status).toBe(403);
    expect(res.json.error).toBe("workspace not allowed");
  });

  it("404s an unknown-but-allowed workspace for an all-access token", async () => {
    const token = await makeToken({ scope: "read" });
    const res = await call(listTasks, {
      bearer: token,
      query: { workspace: "22222222-2222-4222-8222-222222222222" },
    });
    expect(res.status).toBe(404);
  });

  it("only lists workspaces the token can reach", async () => {
    const token = await makeToken({ scope: "read", workspaceIds: [wsB] });
    const res = await call(listWorkspaces, { bearer: token });
    expect(res.status).toBe(200);
    const ids = (res.json.items as { id: string }[]).map((w) => w.id);
    expect(ids).toEqual([wsB]);
  });

  it("drops a deleted workspace id from the token's reach", async () => {
    const token = await makeToken({
      scope: "read",
      workspaceIds: [wsB, "33333333-3333-4333-8333-333333333333"],
    });
    const res = await call(me, { bearer: token });
    expect(res.status).toBe(200);
    expect((res.json.workspaces as unknown[]).length).toBe(1);
  });
});

describe("cross-workspace isolation", () => {
  it("404s a by-id row that lives outside the token's workspaces", async () => {
    const writeAll = await makeToken({ scope: "write" });
    const created = await call(createTask, {
      method: "POST",
      bearer: writeAll,
      query: { workspace: wsA },
      body: { content: "secret in Alpha" },
    });
    const id = (created.json.item as { id: string }).id;

    const scopedToB = await makeToken({ scope: "read", workspaceIds: [wsB] });
    const res = await call(getTask, { bearer: scopedToB, params: { id } });
    expect(res.status).toBe(404);
  });
});

describe("feature toggles", () => {
  it("403s a resource group disabled for the workspace", async () => {
    const wsC = await makeWorkspace("Gamma", { disabledFeatures: ["notes"] });
    const token = await makeToken({ scope: "read", workspaceIds: [wsC] });
    const res = await call(listNotes, { bearer: token });
    expect(res.status).toBe(403);
    expect(res.json.error).toContain("notes is disabled");
  });

  it("allows tasks even though they have no feature flag", async () => {
    const wsC = await makeWorkspace("Gamma", {
      disabledFeatures: ["notes", "meetings", "projects"],
    });
    const token = await makeToken({ scope: "read", workspaceIds: [wsC] });
    const res = await call(listTasks, { bearer: token });
    expect(res.status).toBe(200);
  });
});
