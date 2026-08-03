// Thin client for the Meeting Hub /api/v1 surface. Never log response bodies —
// they contain real work content; errors carry status + a short server message.

export type MeetingHubConfig = {
  baseUrl: string;
  apiToken: string;
};

export type WorkspaceInfo = {
  id: string;
  name: string;
  isDefault: boolean;
  disabledFeatures: string[];
};

async function request<T>(
  cfg: MeetingHubConfig,
  method: "GET" | "PUT",
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${cfg.apiToken}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    const message =
      (json as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(`${method} ${path} failed: ${res.status} ${message}`);
  }
  return { status: res.status, json };
}

export async function getWorkspaces(
  cfg: MeetingHubConfig,
): Promise<WorkspaceInfo[]> {
  const { json } = await request<{ items: WorkspaceInfo[] }>(
    cfg,
    "GET",
    "/api/v1/workspaces",
  );
  return json.items;
}

export async function getSummaryContext(
  cfg: MeetingHubConfig,
  workspaceId: string,
  weekStart: string,
): Promise<unknown> {
  const { json } = await request<{ item: unknown }>(
    cfg,
    "GET",
    `/api/v1/summary-context?workspace=${workspaceId}&weekStart=${weekStart}`,
  );
  return json.item;
}

export async function putSummary(
  cfg: MeetingHubConfig,
  workspaceId: string,
  input: { weekStart: string; markdown: string; model: string; generatedAt: string },
): Promise<{ created: boolean }> {
  const { status } = await request<{ item: unknown }>(
    cfg,
    "PUT",
    `/api/v1/summaries?workspace=${workspaceId}`,
    input,
  );
  return { created: status === 201 };
}
