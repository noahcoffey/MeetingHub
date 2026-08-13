import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { apiTokens, workspaces } from "@/db/schema";
import type { ApiTokenScope } from "@/lib/api-tokens";
import { TEST_USER_ID } from "./constants";

// Content tables to wipe between tests. `truncate ... cascade` handles FK order
// itself, but every table an FK cascades INTO must be named explicitly or
// Postgres emits a "truncate cascades to ..." NOTICE. pending_ingests is the
// one global table with an FK into workspaces, so it's listed here too. The
// seeded user (+ its passkeys/recovery codes) and app_settings survive.
const CONTENT_TABLES = [
  "oauth_codes",
  "oauth_clients",
  "api_tokens",
  "weekly_summaries",
  "task_dependencies",
  "action_items",
  "note_projects",
  "note_meetings",
  "notes",
  "project_milestones",
  "project_links",
  "project_relations",
  "agenda_items",
  "person_meeting_titles",
  "people",
  "meetings",
  "journal_stat_values",
  "journal_stats",
  "journal_entries",
  "hidden_meeting_titles",
  "pending_ingests",
  "projects",
  "google_accounts",
  "workspaces",
];

export async function resetDb(): Promise<void> {
  await db.execute(
    sql.raw(`truncate ${CONTENT_TABLES.join(", ")} restart identity cascade`),
  );
}

export async function makeWorkspace(
  name: string,
  opts: { disabledFeatures?: string[]; isDefault?: boolean } = {},
): Promise<string> {
  const [row] = await db
    .insert(workspaces)
    .values({
      name,
      isDefault: opts.isDefault ?? false,
      disabledFeatures: (opts.disabledFeatures ?? []) as never,
    })
    .returning({ id: workspaces.id });
  return row.id;
}

// Insert a token directly and return the plaintext secret to present as a
// bearer. Mirrors createApiToken's format so verifyApiToken accepts it.
export async function makeToken(opts: {
  scope: ApiTokenScope;
  workspaceIds?: string[] | null;
  expiresAt?: Date | null;
  name?: string;
}): Promise<string> {
  const secret = "mh_" + randomBytes(32).toString("base64url");
  await db.insert(apiTokens).values({
    userId: TEST_USER_ID,
    name: opts.name ?? "test",
    tokenPrefix: secret.slice(0, 12),
    tokenHash: createHash("sha256").update(secret).digest("hex"),
    scope: opts.scope,
    workspaceIds: opts.workspaceIds ?? null,
    expiresAt: opts.expiresAt ?? null,
  });
  return secret;
}

type Json = Record<string, unknown>;
type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

// Invoke a route handler the way Next would: a Request plus a ctx whose params
// resolve to the dynamic segments.
export async function call(
  handler: Handler,
  opts: {
    method?: string;
    bearer?: string;
    query?: Record<string, string>;
    body?: Json;
    params?: Record<string, string>;
  } = {},
): Promise<{ status: number; json: Record<string, unknown> }> {
  const url = new URL("http://test.local/api/v1/x");
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = {};
  if (opts.bearer) headers.authorization = `Bearer ${opts.bearer}`;
  const init: RequestInit = { method: opts.method ?? "GET", headers };
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  const req = new Request(url, init);
  const res = await handler(req, {
    params: Promise.resolve(opts.params ?? {}),
  });
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    json = {};
  }
  return { status: res.status, json };
}
