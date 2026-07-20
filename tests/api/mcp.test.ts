import { beforeEach, describe, expect, it } from "vitest";
import { POST as mcp } from "@/app/api/[transport]/route";
import { call, makeToken, makeWorkspace, resetDb } from "../helpers";
import { GET as listTasksV1 } from "@/app/api/v1/tasks/route";

// Drives the streamable-HTTP MCP endpoint the way claude.ai does: independent
// JSON-RPC POSTs (stateless mode — no session handshake required).

let ws: string;

beforeEach(async () => {
  await resetDb();
  ws = await makeWorkspace("Alpha", { isDefault: true });
});

type Rpc = { jsonrpc: "2.0"; id: number; method: string; params?: unknown };

async function rpc(bearer: string | null, body: Rpc) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  const res = await mcp(
    new Request("http://test.local/api/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );
  const text = await res.text();
  // Streamable HTTP frames responses as SSE; unwrap the first data: line.
  const dataLine = text
    .split("\n")
    .find((l) => l.startsWith("data:"));
  const json = dataLine
    ? (JSON.parse(dataLine.slice(5)) as Record<string, unknown>)
    : text
      ? (JSON.parse(text) as Record<string, unknown>)
      : {};
  return { status: res.status, headers: res.headers, json };
}

const INITIALIZE: Rpc = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "test-client", version: "1.0" },
  },
};

describe("MCP endpoint auth", () => {
  it("401s without a bearer and advertises the resource metadata", async () => {
    const res = await rpc(null, INITIALIZE);
    expect(res.status).toBe(401);
    const www = res.headers.get("www-authenticate") ?? "";
    expect(www).toContain("resource_metadata");
    expect(www).toContain("/.well-known/oauth-protected-resource");
  });

  it("401s with an invalid bearer", async () => {
    const res = await rpc("mh_invalid", INITIALIZE);
    expect(res.status).toBe(401);
  });
});

describe("MCP protocol", () => {
  it("initializes and identifies itself", async () => {
    const token = await makeToken({ scope: "read" });
    const res = await rpc(token, INITIALIZE);
    expect(res.status).toBe(200);
    const result = res.json.result as {
      serverInfo: { name: string };
      capabilities: Record<string, unknown>;
    };
    expect(result.serverInfo.name).toBe("meeting-hub");
    expect(result.capabilities.tools).toBeDefined();
  });

  it("lists the tool catalog", async () => {
    const token = await makeToken({ scope: "read" });
    const res = await rpc(token, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(res.status).toBe(200);
    const tools = (res.json.result as { tools: { name: string }[] }).tools;
    const names = tools.map((t) => t.name);
    expect(names).toContain("list_workspaces");
    expect(names).toContain("list_tasks");
    expect(names).toContain("create_task");
    expect(names).toContain("get_meeting");
    expect(names).toContain("update_note");
  });

  it("executes a read tool with the caller's token", async () => {
    const token = await makeToken({ scope: "read" });
    const res = await rpc(token, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_workspaces", arguments: {} },
    });
    expect(res.status).toBe(200);
    const result = res.json.result as {
      isError?: boolean;
      content: { type: string; text: string }[];
    };
    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(result.content[0].text) as {
      items: { name: string }[];
    };
    expect(payload.items.map((w) => w.name)).toContain("Alpha");
  });

  it("enforces token scope through the proxied v1 layer", async () => {
    const readToken = await makeToken({ scope: "read" });
    const res = await rpc(readToken, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "create_task",
        arguments: { workspace: ws, content: "should be rejected" },
      },
    });
    expect(res.status).toBe(200);
    const result = res.json.result as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("read-only");
  });

  it("round-trips a write: create via MCP, visible via v1", async () => {
    const token = await makeToken({ scope: "write" });
    const res = await rpc(token, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "create_task",
        arguments: { workspace: ws, content: "born over MCP", priority: 1 },
      },
    });
    const result = res.json.result as {
      isError?: boolean;
      content: { text: string }[];
    };
    expect(result.isError).toBeFalsy();
    const created = JSON.parse(result.content[0].text) as {
      item: { id: string; content: string; priority: number };
    };
    expect(created.item.content).toBe("born over MCP");
    expect(created.item.priority).toBe(1);

    // And it's a real row the REST surface can see.
    const v1 = await call(listTasksV1, {
      bearer: token,
      query: { workspace: ws },
    });
    expect(v1.status).toBe(200);
    const contents = (v1.json.items as { content: string }[]).map(
      (t) => t.content,
    );
    expect(contents).toContain("born over MCP");
  });
});
