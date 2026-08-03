import { beforeEach, describe, expect, it } from "vitest";
import {
  GET as listSummaries,
  PUT as putSummary,
} from "@/app/api/v1/summaries/route";
import { GET as getSummary } from "@/app/api/v1/summaries/[id]/route";
import { call, makeToken, makeWorkspace, resetDb } from "../helpers";

let wsA: string;
let wsB: string;
let write: string;
let read: string;

const MONDAY = "2026-08-03";

beforeEach(async () => {
  await resetDb();
  wsA = await makeWorkspace("Alpha", { isDefault: true });
  wsB = await makeWorkspace("Beta");
  write = await makeToken({ scope: "write" });
  read = await makeToken({ scope: "read" });
});

const idOf = (r: { json: Record<string, unknown> }) =>
  (r.json.item as { id: string }).id;

describe("PUT /api/v1/summaries", () => {
  it("creates with 201, then upserts the same week with 200 keeping the id", async () => {
    const created = await call(putSummary, {
      method: "PUT",
      bearer: write,
      query: { workspace: wsA },
      body: { weekStart: MONDAY, markdown: "# v1", model: "claude-opus-5" },
    });
    expect(created.status).toBe(201);

    const updated = await call(putSummary, {
      method: "PUT",
      bearer: write,
      query: { workspace: wsA },
      body: { weekStart: MONDAY, markdown: "# v2" },
    });
    expect(updated.status).toBe(200);
    expect(idOf(updated)).toBe(idOf(created));
    expect((updated.json.item as { markdown: string }).markdown).toBe("# v2");
    expect((updated.json.item as { model: string | null }).model).toBeNull();
  });

  it("rejects a read-only token", async () => {
    const res = await call(putSummary, {
      method: "PUT",
      bearer: read,
      query: { workspace: wsA },
      body: { weekStart: MONDAY, markdown: "# x" },
    });
    expect(res.status).toBe(403);
  });

  it("rejects a non-Monday weekStart, a bad date, and missing markdown", async () => {
    for (const body of [
      { weekStart: "2026-08-04", markdown: "# x" }, // Tuesday
      { weekStart: "not-a-date", markdown: "# x" },
      { weekStart: MONDAY },
      { weekStart: MONDAY, markdown: "   " },
    ]) {
      const res = await call(putSummary, {
        method: "PUT",
        bearer: write,
        query: { workspace: wsA },
        body,
      });
      expect(res.status).toBe(400);
    }
  });

  it("rejects an invalid generatedAt", async () => {
    const res = await call(putSummary, {
      method: "PUT",
      bearer: write,
      query: { workspace: wsA },
      body: { weekStart: MONDAY, markdown: "# x", generatedAt: "yesterday" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects an oversized body with 413", async () => {
    const res = await call(putSummary, {
      method: "PUT",
      bearer: write,
      query: { workspace: wsA },
      body: { weekStart: MONDAY, markdown: "x".repeat(1_100_000) },
    });
    expect(res.status).toBe(413);
  });

  it("requires ?workspace= for an unrestricted token and enforces restriction", async () => {
    const noWs = await call(putSummary, {
      method: "PUT",
      bearer: write,
      body: { weekStart: MONDAY, markdown: "# x" },
    });
    expect(noWs.status).toBe(400);

    const restricted = await makeToken({ scope: "write", workspaceIds: [wsA] });
    const outside = await call(putSummary, {
      method: "PUT",
      bearer: restricted,
      query: { workspace: wsB },
      body: { weekStart: MONDAY, markdown: "# x" },
    });
    expect(outside.status).toBe(403);
  });
});

describe("GET /api/v1/summaries", () => {
  it("lists meta only, most recent week first", async () => {
    for (const [week, md] of [
      ["2026-07-27", "# old"],
      ["2026-08-03", "# new"],
    ]) {
      await call(putSummary, {
        method: "PUT",
        bearer: write,
        query: { workspace: wsA },
        body: { weekStart: week, markdown: md },
      });
    }
    const res = await call(listSummaries, {
      bearer: read,
      query: { workspace: wsA },
    });
    expect(res.status).toBe(200);
    const items = res.json.items as { weekStart: string; markdown?: string }[];
    expect(items.map((i) => i.weekStart)).toEqual(["2026-08-03", "2026-07-27"]);
    expect(items[0].markdown).toBeUndefined();
  });

  it("scopes the list to the workspace", async () => {
    await call(putSummary, {
      method: "PUT",
      bearer: write,
      query: { workspace: wsB },
      body: { weekStart: MONDAY, markdown: "# b" },
    });
    const res = await call(listSummaries, {
      bearer: read,
      query: { workspace: wsA },
    });
    expect(res.json.items).toEqual([]);
  });
});

describe("GET /api/v1/summaries/[id]", () => {
  it("returns the full row including markdown", async () => {
    const created = await call(putSummary, {
      method: "PUT",
      bearer: write,
      query: { workspace: wsA },
      body: { weekStart: MONDAY, markdown: "# body" },
    });
    const res = await call(getSummary, {
      bearer: read,
      params: { id: idOf(created) },
    });
    expect(res.status).toBe(200);
    expect((res.json.item as { markdown: string }).markdown).toBe("# body");
  });

  it("404s outside the token's workspace restriction (no existence leak)", async () => {
    const created = await call(putSummary, {
      method: "PUT",
      bearer: write,
      query: { workspace: wsB },
      body: { weekStart: MONDAY, markdown: "# b" },
    });
    const restricted = await makeToken({ scope: "read", workspaceIds: [wsA] });
    const res = await call(getSummary, {
      bearer: restricted,
      params: { id: idOf(created) },
    });
    expect(res.status).toBe(404);
  });

  it("404s on an unknown id", async () => {
    const res = await call(getSummary, {
      bearer: read,
      params: { id: "00000000-0000-0000-0000-000000000000" },
    });
    expect(res.status).toBe(404);
  });
});

describe("auth", () => {
  it("401s without a bearer", async () => {
    const res = await call(listSummaries, { query: { workspace: "x" } });
    expect(res.status).toBe(401);
  });
});
