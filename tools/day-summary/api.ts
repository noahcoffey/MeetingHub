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

// Mirrors DaySummaryContext in src/lib/day-summary-context.ts. The server does
// the day bucketing, the timezone formatting and the generated-notes trimming,
// so this runner holds no second copy of any of that.
export type DaySummaryContext = {
  date: string;
  dateLabel: string;
  hasNotes: boolean;
  meetingCount: number;
  totalTimeLabel: string;
  inputFingerprint: string;
  meetings: {
    title: string;
    timeLabel: string;
    startTime: string;
    endTime: string | null;
    attendees: string[];
    notes: string;
    generatedSections: string;
  }[];
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
    const message = (json as { error?: string }).error ?? `HTTP ${res.status}`;
    const err = new Error(`${method} ${path} failed: ${res.status} ${message}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
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

export async function getDaySummaryContext(
  cfg: MeetingHubConfig,
  workspaceId: string,
  date: string,
): Promise<DaySummaryContext> {
  const { json } = await request<{ item: DaySummaryContext }>(
    cfg,
    "GET",
    `/api/v1/day-summary-context?workspace=${workspaceId}&date=${date}`,
  );
  return json.item;
}

export async function putDaySummary(
  cfg: MeetingHubConfig,
  workspaceId: string,
  input: {
    date: string;
    markdown: string;
    model: string;
    generatedAt: string;
    // Echoed from the context read, NOT recomputed by the server — notes can
    // land during the minutes the model is writing, and the stored fingerprint
    // must describe the inputs this summary was actually written from.
    inputFingerprint: string;
  },
): Promise<{ created: boolean }> {
  const { status } = await request<{ item: unknown }>(
    cfg,
    "PUT",
    `/api/v1/day-summaries?workspace=${workspaceId}`,
    input,
  );
  return { created: status === 201 };
}
