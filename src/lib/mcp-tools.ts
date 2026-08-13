import "server-only";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as v1Workspaces from "@/app/api/v1/workspaces/route";
import * as v1Tasks from "@/app/api/v1/tasks/route";
import * as v1Task from "@/app/api/v1/tasks/[id]/route";
import * as v1TaskComplete from "@/app/api/v1/tasks/[id]/complete/route";
import * as v1Meetings from "@/app/api/v1/meetings/route";
import * as v1Meeting from "@/app/api/v1/meetings/[id]/route";
import * as v1Projects from "@/app/api/v1/projects/route";
import * as v1Project from "@/app/api/v1/projects/[id]/route";
import * as v1ProjectMilestones from "@/app/api/v1/projects/[id]/milestones/route";
import * as v1Milestone from "@/app/api/v1/milestones/[id]/route";
import * as v1Notes from "@/app/api/v1/notes/route";
import * as v1Note from "@/app/api/v1/notes/[id]/route";

// Every MCP tool is a thin in-process proxy over the corresponding /api/v1
// route handler (invoked exactly like tests/helpers.ts does), forwarding the
// caller's bearer token. That keeps auth, workspace scoping, feature toggles,
// and input validation in ONE place — the v1 layer — and the tool surface
// automatically stays in lockstep with the documented REST API.

type V1Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

type CallOpts = {
  method?: string;
  query?: Record<string, string | undefined>;
  body?: Record<string, unknown>;
  params?: Record<string, string>;
};

async function callV1(handler: V1Handler, bearer: string, opts: CallOpts = {}) {
  // Any base works — handlers only read the path's search params.
  const url = new URL("http://mcp.internal/api/v1");
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {
    authorization: `Bearer ${bearer}`,
  };
  const init: RequestInit = { method: opts.method ?? "GET", headers };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  const res = await handler(new Request(url, init), {
    params: Promise.resolve(opts.params ?? {}),
  });
  let json: unknown = {};
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  return { status: res.status, json };
}

type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

function toResult({ status, json }: { status: number; json: unknown }): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(json, null, 2) }],
    isError: status >= 400,
  };
}

const NO_AUTH: ToolResult = {
  content: [{ type: "text", text: JSON.stringify({ error: "unauthorized" }) }],
  isError: true,
};

// Shared param fragments.
const workspaceParam = {
  workspace: z
    .string()
    .uuid()
    .optional()
    .describe(
      "Workspace id (see list_workspaces). Optional only when the access token is restricted to a single workspace.",
    ),
};
const idParam = { id: z.string().uuid().describe("Row id") };
const DATE_DESC = "Date as YYYY-MM-DD";

// The exact (name, description, shape, cb) overload of server.tool we call.
// TS can't unify an open generic shape with the SDK's overload set, so the
// helper below narrows server.tool to this signature once instead of casting
// at every call site.
type ToolRegistrar = (
  name: string,
  description: string,
  shape: z.ZodRawShape,
  cb: (
    args: unknown,
    extra: { authInfo?: { token?: string } },
  ) => Promise<ToolResult>,
) => void;

export function registerTools(server: McpServer): void {
  const register = server.tool.bind(server) as unknown as ToolRegistrar;

  // Local helper so every tool shares the bearer-forwarding boilerplate.
  function tool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    run: (
      args: z.objectOutputType<S, z.ZodTypeAny>,
      bearer: string,
    ) => Promise<{ status: number; json: unknown }>,
  ): void {
    register(name, description, shape, async (args, extra) => {
      const bearer = extra.authInfo?.token;
      if (!bearer) return NO_AUTH;
      return toResult(
        await run(args as z.objectOutputType<S, z.ZodTypeAny>, bearer),
      );
    });
  }

  // ---- workspaces ----
  tool(
    "list_workspaces",
    "List the workspaces this token can access. Workspace ids returned here are what other tools take as the `workspace` argument.",
    {},
    (_args, bearer) => callV1(v1Workspaces.GET, bearer),
  );

  // ---- tasks ----
  tool(
    "list_tasks",
    "List tasks (action items) in a workspace. status: open (default), done, or scheduled (snoozed / not-yet-due recurring).",
    {
      ...workspaceParam,
      status: z.enum(["open", "done", "scheduled"]).optional(),
    },
    (args, bearer) =>
      callV1(v1Tasks.GET, bearer, {
        query: { workspace: args.workspace, status: args.status },
      }),
  );

  tool("get_task", "Get a single task by id.", idParam, (args, bearer) =>
    callV1(v1Task.GET, bearer, { params: { id: args.id } }),
  );

  tool(
    "create_task",
    "Create a task. Requires write scope.",
    {
      ...workspaceParam,
      content: z.string().min(1).describe("The task text"),
      dueDate: z.string().optional().describe(DATE_DESC),
      projectId: z.string().uuid().optional(),
      milestoneId: z.string().uuid().optional(),
      priority: z
        .number()
        .int()
        .min(1)
        .max(3)
        .optional()
        .describe("1=high, 2=medium, 3=low"),
      recurrenceUnit: z
        .enum(["day", "weekday", "week", "month", "year"])
        .optional(),
      recurrenceInterval: z
        .number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Repeat every N units (with recurrenceUnit)"),
      ownerName: z
        .string()
        .optional()
        .describe("Set when waiting on someone else — their name"),
    },
    ({ workspace, ...body }, bearer) =>
      callV1(v1Tasks.POST, bearer, {
        method: "POST",
        query: { workspace },
        body,
      }),
  );

  tool(
    "update_task",
    "Partially update a task. Pass null to clear a nullable field. Setting status to done completes it (a recurring task spawns its next occurrence, returned as `next`). Requires write scope.",
    {
      ...idParam,
      content: z.string().min(1).optional(),
      status: z.enum(["open", "done"]).optional(),
      dueDate: z.string().nullable().optional().describe(DATE_DESC),
      projectId: z.string().uuid().nullable().optional(),
      milestoneId: z.string().uuid().nullable().optional(),
      priority: z.number().int().min(1).max(3).nullable().optional(),
      recurrenceUnit: z
        .enum(["day", "weekday", "week", "month", "year"])
        .nullable()
        .optional(),
      recurrenceInterval: z.number().int().min(1).max(365).optional(),
      snoozedUntil: z
        .string()
        .nullable()
        .optional()
        .describe(`${DATE_DESC}; hides the task from open lists until then`),
      ownerName: z.string().nullable().optional(),
    },
    ({ id, ...body }, bearer) =>
      callV1(v1Task.PATCH, bearer, {
        method: "PATCH",
        params: { id },
        body,
      }),
  );

  tool(
    "complete_task",
    "Mark a task done. A recurring task spawns its next occurrence, returned as `next`. Requires write scope.",
    idParam,
    (args, bearer) =>
      callV1(v1TaskComplete.POST, bearer, {
        method: "POST",
        params: { id: args.id },
      }),
  );

  // ---- meetings ----
  tool(
    "list_meetings",
    "List meetings in a date range (defaults to the last 30 days). Returns summaries without note bodies — use get_meeting for notes.",
    {
      ...workspaceParam,
      from: z.string().optional().describe(DATE_DESC),
      to: z.string().optional().describe(DATE_DESC),
    },
    (args, bearer) =>
      callV1(v1Meetings.GET, bearer, {
        query: { workspace: args.workspace, from: args.from, to: args.to },
      }),
  );

  tool(
    "get_meeting",
    "Get a meeting by id, including its notes and generated notes.",
    idParam,
    (args, bearer) => callV1(v1Meeting.GET, bearer, { params: { id: args.id } }),
  );

  tool(
    "create_meeting",
    "Create a manual meeting. Requires write scope.",
    {
      ...workspaceParam,
      title: z.string().min(1),
      startTime: z.string().describe("ISO 8601 datetime"),
      endTime: z.string().optional().describe("ISO 8601 datetime"),
    },
    ({ workspace, ...body }, bearer) =>
      callV1(v1Meetings.POST, bearer, {
        method: "POST",
        query: { workspace },
        body,
      }),
  );

  tool(
    "update_meeting",
    "Partially update a meeting (title, times, project, or the markdown notes body). Requires write scope.",
    {
      ...idParam,
      title: z.string().min(1).optional(),
      startTime: z.string().optional().describe("ISO 8601 datetime"),
      endTime: z.string().nullable().optional().describe("ISO 8601 datetime"),
      projectId: z.string().uuid().nullable().optional(),
      notes: z.string().optional().describe("Full markdown notes body (replaces the current one)"),
    },
    ({ id, ...body }, bearer) =>
      callV1(v1Meeting.PATCH, bearer, {
        method: "PATCH",
        params: { id },
        body,
      }),
  );

  // ---- projects ----
  tool(
    "list_projects",
    "List projects in a workspace (active only unless includeArchived/includeParked). Parked projects are ideas captured in a meeting that aren't real initiatives yet.",
    {
      ...workspaceParam,
      includeArchived: z.boolean().optional(),
      includeParked: z.boolean().optional(),
    },
    (args, bearer) =>
      callV1(v1Projects.GET, bearer, {
        query: {
          workspace: args.workspace,
          includeArchived: args.includeArchived ? "true" : undefined,
          includeParked: args.includeParked ? "true" : undefined,
        },
      }),
  );

  tool("get_project", "Get a project by id.", idParam, (args, bearer) =>
    callV1(v1Project.GET, bearer, { params: { id: args.id } }),
  );

  tool(
    "create_project",
    "Create a project. Requires write scope.",
    {
      ...workspaceParam,
      name: z.string().min(1),
      description: z.string().optional(),
      deadline: z.string().optional().describe(DATE_DESC),
    },
    ({ workspace, ...body }, bearer) =>
      callV1(v1Projects.POST, bearer, {
        method: "POST",
        query: { workspace },
        body,
      }),
  );

  tool(
    "update_project",
    "Partially update a project. status archived/active archives/restores it; parked/active parks or promotes an idea. Requires write scope.",
    {
      ...idParam,
      name: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      deadline: z.string().nullable().optional().describe(DATE_DESC),
      status: z.enum(["active", "archived", "parked"]).optional(),
    },
    ({ id, ...body }, bearer) =>
      callV1(v1Project.PATCH, bearer, {
        method: "PATCH",
        params: { id },
        body,
      }),
  );

  // ---- milestones ----
  tool(
    "list_milestones",
    "List a project's milestones with task progress counts.",
    { projectId: z.string().uuid() },
    (args, bearer) =>
      callV1(v1ProjectMilestones.GET, bearer, {
        params: { id: args.projectId },
      }),
  );

  tool(
    "create_milestone",
    "Add a milestone to a project. Requires write scope.",
    {
      projectId: z.string().uuid(),
      name: z.string().min(1),
      dueDate: z.string().optional().describe(DATE_DESC),
    },
    ({ projectId, ...body }, bearer) =>
      callV1(v1ProjectMilestones.POST, bearer, {
        method: "POST",
        params: { id: projectId },
        body,
      }),
  );

  tool("get_milestone", "Get a milestone by id.", idParam, (args, bearer) =>
    callV1(v1Milestone.GET, bearer, { params: { id: args.id } }),
  );

  tool(
    "update_milestone",
    "Partially update a milestone; completed true/false marks it done or reopens it. Requires write scope.",
    {
      ...idParam,
      name: z.string().min(1).optional(),
      dueDate: z.string().nullable().optional().describe(DATE_DESC),
      completed: z.boolean().optional(),
    },
    ({ id, ...body }, bearer) =>
      callV1(v1Milestone.PATCH, bearer, {
        method: "PATCH",
        params: { id },
        body,
      }),
  );

  // ---- notes ----
  tool(
    "list_notes",
    "List reference notes in a workspace (summaries: title + attachments, no bodies).",
    workspaceParam,
    (args, bearer) =>
      callV1(v1Notes.GET, bearer, { query: { workspace: args.workspace } }),
  );

  tool(
    "get_note",
    "Get a note by id; the markdown body is in `notes`.",
    idParam,
    (args, bearer) => callV1(v1Note.GET, bearer, { params: { id: args.id } }),
  );

  tool(
    "create_note",
    "Create a reference note, optionally attached to a project and/or meeting in the same workspace. Requires write scope.",
    {
      ...workspaceParam,
      title: z.string().optional(),
      body: z.string().optional().describe("Markdown body"),
      projectId: z.string().uuid().optional(),
      meetingId: z.string().uuid().optional(),
    },
    ({ workspace, ...body }, bearer) =>
      callV1(v1Notes.POST, bearer, {
        method: "POST",
        query: { workspace },
        body,
      }),
  );

  tool(
    "update_note",
    "Update a note's title and/or markdown body. Requires write scope.",
    {
      ...idParam,
      title: z.string().optional(),
      body: z.string().optional().describe("Full markdown body (replaces the current one)"),
    },
    ({ id, ...body }, bearer) =>
      callV1(v1Note.PATCH, bearer, {
        method: "PATCH",
        params: { id },
        body,
      }),
  );
}
