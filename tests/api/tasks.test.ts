import { beforeEach, describe, expect, it } from "vitest";
import { GET as listTasks, POST as createTask } from "@/app/api/v1/tasks/route";
import {
  GET as getTask,
  PATCH as patchTask,
} from "@/app/api/v1/tasks/[id]/route";
import { POST as completeTask } from "@/app/api/v1/tasks/[id]/complete/route";
import { POST as createProject } from "@/app/api/v1/projects/route";
import { call, makeToken, makeWorkspace, resetDb } from "../helpers";

let wsA: string;
let wsB: string;
let write: string;
let read: string;

beforeEach(async () => {
  await resetDb();
  wsA = await makeWorkspace("Alpha", { isDefault: true });
  wsB = await makeWorkspace("Beta");
  write = await makeToken({ scope: "write" });
  read = await makeToken({ scope: "read" });
});

async function newTask(body: Record<string, unknown>, ws = wsA) {
  const res = await call(createTask, {
    method: "POST",
    bearer: write,
    query: { workspace: ws },
    body,
  });
  return res;
}

describe("task create", () => {
  it("requires content", async () => {
    const res = await newTask({ content: "  " });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("content is required");
  });

  it("rejects a malformed due date", async () => {
    const res = await newTask({ content: "x", dueDate: "07/20/2026" });
    expect(res.status).toBe(400);
  });

  it("creates a task and trims content", async () => {
    const res = await newTask({ content: "  ship it  ", priority: 1 });
    expect(res.status).toBe(201);
    const item = res.json.item as { content: string; priority: number };
    expect(item.content).toBe("ship it");
    expect(item.priority).toBe(1);
  });
});

describe("task listing", () => {
  it("filters by status", async () => {
    await newTask({ content: "open one" });
    const done = await newTask({ content: "done one" });
    await call(completeTask, {
      method: "POST",
      bearer: write,
      params: { id: (done.json.item as { id: string }).id },
    });

    const open = await call(listTasks, {
      bearer: read,
      query: { workspace: wsA, status: "open" },
    });
    expect((open.json.items as unknown[]).length).toBe(1);

    const completed = await call(listTasks, {
      bearer: read,
      query: { workspace: wsA, status: "done" },
    });
    expect((completed.json.items as unknown[]).length).toBe(1);
  });

  it("rejects an unknown status", async () => {
    const res = await call(listTasks, {
      bearer: read,
      query: { workspace: wsA, status: "nonsense" },
    });
    expect(res.status).toBe(400);
  });
});

describe("task update", () => {
  it("patches content and status", async () => {
    const created = await newTask({ content: "before" });
    const id = (created.json.item as { id: string }).id;
    const res = await call(patchTask, {
      method: "PATCH",
      bearer: write,
      params: { id },
      body: { content: "after", status: "done" },
    });
    expect(res.status).toBe(200);
    const item = res.json.item as { content: string; status: string };
    expect(item.content).toBe("after");
    expect(item.status).toBe("done");
  });

  it("404s a nonexistent task", async () => {
    const res = await call(patchTask, {
      method: "PATCH",
      bearer: write,
      params: { id: "44444444-4444-4444-8444-444444444444" },
      body: { content: "x" },
    });
    expect(res.status).toBe(404);
  });

  it("rejects an empty patch", async () => {
    const created = await newTask({ content: "x" });
    const id = (created.json.item as { id: string }).id;
    const res = await call(patchTask, {
      method: "PATCH",
      bearer: write,
      params: { id },
      body: {},
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("nothing to update");
  });
});

describe("recurrence", () => {
  it("spawns the next occurrence on completing a recurring task", async () => {
    const created = await newTask({
      content: "weekly review",
      dueDate: "2026-07-17",
      recurrenceUnit: "week",
    });
    const id = (created.json.item as { id: string }).id;
    const res = await call(completeTask, {
      method: "POST",
      bearer: write,
      params: { id },
    });
    expect(res.status).toBe(200);
    const { item, next } = res.json as {
      item: { status: string };
      next: { recurrenceUnit: string; dueDate: string } | null;
    };
    expect(item.status).toBe("done");
    expect(next).not.toBeNull();
    expect(next?.recurrenceUnit).toBe("week");
  });
});

describe("cross-workspace references", () => {
  it("rejects a projectId from another workspace on create", async () => {
    const proj = await call(createProject, {
      method: "POST",
      bearer: write,
      query: { workspace: wsB },
      body: { name: "Beta project" },
    });
    const projectId = (proj.json.item as { id: string }).id;

    const res = await newTask({ content: "x", projectId }, wsA);
    expect(res.status).toBe(400);
    expect(res.json.error).toBe("projectId not in workspace");
  });

  it("rejects moving a task onto a cross-workspace project", async () => {
    const proj = await call(createProject, {
      method: "POST",
      bearer: write,
      query: { workspace: wsB },
      body: { name: "Beta project" },
    });
    const projectId = (proj.json.item as { id: string }).id;
    const created = await newTask({ content: "x" }, wsA);
    const id = (created.json.item as { id: string }).id;

    const res = await call(patchTask, {
      method: "PATCH",
      bearer: write,
      params: { id },
      body: { projectId },
    });
    expect(res.status).toBe(400);
  });
});

describe("body limits", () => {
  it("413s a body over 1 MB", async () => {
    const res = await newTask({ content: "x".repeat(1024 * 1024 + 10) });
    expect(res.status).toBe(413);
  });

  it("400s invalid json", async () => {
    const url = new URL("http://test.local/api/v1/tasks");
    url.searchParams.set("workspace", wsA);
    const req = new Request(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${write}`,
        "content-type": "application/json",
      },
      body: "{not json",
    });
    const res = await createTask(req, { params: Promise.resolve({}) });
    expect(res.status).toBe(400);
  });
});
