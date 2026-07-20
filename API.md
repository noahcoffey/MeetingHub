# Meeting Hub API (v1)

Programmatic access to tasks, meetings, projects, milestones, and notes via
`/api/v1/*`. Authenticated with scoped bearer tokens created under
**Settings → API tokens** (the note-ingest push contract is separate — see
`INGEST_API.md`).

> Prefer tools over raw HTTP? The same surface is exposed as a remote **MCP
> server** at `/api/mcp` (streamable HTTP + OAuth) — see the "MCP connector"
> section in `README.md`. MCP tool calls are proxied through these v1
> endpoints, so everything below (scopes, workspace rules, error shapes)
> applies there too.

> A machine-readable **OpenAPI 3.0** spec covering this API (and the ingest
> endpoint) lives at [`openapi.yaml`](public/openapi.yaml) — import it into
> Postman/Insomnia or render it with Swagger UI / Redoc.

## Authentication

```
Authorization: Bearer mh_<secret>
```

Tokens are created in Settings → API tokens and shown **once** at creation
(only a SHA-256 hash is stored). Each token has:

- **Scope** — `read` (GET only) or `write` (read + create/update).
- **Workspace restriction** — all workspaces, or a chosen subset.
- **Optional expiry** — expired tokens 401 like revoked ones.

Revoke a token in Settings; revocation is immediate.

## Workspace selection

Content is partitioned by workspace. Collection endpoints (list/create) take a
`?workspace=<uuid>` query param:

- Token restricted to exactly **one** workspace → the param is optional (that
  workspace is the default).
- Otherwise the param is **required** (400 without it).
- A workspace outside the token's restriction → 403; unknown id → 404.

Discover ids with `GET /api/v1/workspaces`. By-id endpoints (get/update) don't
take the param — the row's own workspace is checked against the token, and a
row outside the allowed set returns **404** (indistinguishable from missing).

Workspace feature toggles are enforced: a resource group disabled for a
workspace (Settings → Workspaces) returns
`403 { "error": "<feature> is disabled in this workspace" }`. Tasks are always
on.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/me` | Token introspection: name, prefix, scope, allowed workspaces, expiry |
| GET | `/api/v1/workspaces` | Workspaces this token can reach |
| GET | `/api/v1/tasks?workspace=&status=` | `status`: `open` (default), `done`, `scheduled` (snoozed/not-yet-due recurring) |
| POST | `/api/v1/tasks?workspace=` | Create a task |
| GET | `/api/v1/tasks/:id` | |
| PATCH | `/api/v1/tasks/:id` | Partial update; returns `{ item, next }` (`next` = spawned recurrence, else null) |
| POST | `/api/v1/tasks/:id/complete` | Mark done; same `{ item, next }` shape |
| GET | `/api/v1/meetings?workspace=&from=&to=` | Summaries (no note bodies). `from`/`to` `YYYY-MM-DD`; default last 30 days |
| POST | `/api/v1/meetings?workspace=` | `{ title, startTime (ISO), endTime? }` |
| GET | `/api/v1/meetings/:id` | Full row incl. `notes` and `notesGenerated` |
| PATCH | `/api/v1/meetings/:id` | `{ title?, startTime?, endTime?, projectId?, notes? }` |
| GET | `/api/v1/projects?workspace=&includeArchived=true` | |
| POST | `/api/v1/projects?workspace=` | `{ name, description?, deadline? }` |
| GET | `/api/v1/projects/:id` | |
| PATCH | `/api/v1/projects/:id` | `{ name?, description?, deadline?, status? }` (`active`/`archived`) |
| GET | `/api/v1/projects/:id/milestones` | Includes task progress counts |
| POST | `/api/v1/projects/:id/milestones` | `{ name, dueDate? }` |
| GET | `/api/v1/milestones/:id` | |
| PATCH | `/api/v1/milestones/:id` | `{ name?, dueDate?, completed? }` |
| GET | `/api/v1/notes?workspace=` | Summaries (title, attached projects, meeting count) |
| POST | `/api/v1/notes?workspace=` | `{ title?, body?, projectId?, meetingId? }` (same-workspace attach at create only) |
| GET | `/api/v1/notes/:id` | Full row; body is in `notes` |
| PATCH | `/api/v1/notes/:id` | `{ title?, body? }` |

Responses: lists are `{ items: [...] }`, single rows `{ item: {...} }`,
creates return 201. Dates are ISO 8601; day-scoped fields (`dueDate`,
`deadline`) are `YYYY-MM-DD`.

### Example: tasks

```bash
# List open tasks
curl -H "Authorization: Bearer mh_..." \
  "https://<host>/api/v1/tasks?workspace=<uuid>"

# Create
curl -X POST -H "Authorization: Bearer mh_..." \
  -H "Content-Type: application/json" \
  -d '{"content": "Send the follow-up", "dueDate": "2026-07-20", "priority": 1}' \
  "https://<host>/api/v1/tasks?workspace=<uuid>"

# Complete (recurring tasks return the spawned next occurrence)
curl -X POST -H "Authorization: Bearer mh_..." \
  "https://<host>/api/v1/tasks/<id>/complete"
```

Task fields on create/update: `content` (required on create), `dueDate`,
`projectId`, `milestoneId` (must belong to the same workspace/project),
`priority` (1=high 2=medium 3=low, null clears), `ownerName` (marks the task
waiting-on), `recurrenceUnit` (`day|weekday|week|month|year`) +
`recurrenceInterval`, `snoozedUntil`, `status` (`open`/`done`).

## Errors

All errors are `{ "error": "<message>" }`:

- **400** — invalid/missing fields, missing `workspace` param, cross-workspace
  `projectId`/`milestoneId`.
- **401** — missing, malformed, revoked, or expired token.
- **403** — write with a read-only token, disallowed workspace, disabled
  feature.
- **404** — row missing *or* outside the token's workspaces (no existence
  leak).
- **413** — body over 1 MB.

## Limits (v1)

- No pagination — lists return everything in the workspace (fine at
  single-user scale).
- No DELETE endpoints.
- Note/meeting-notes `PATCH` is last-write-wins (no optimistic-concurrency
  check; the web editor's conflict handling doesn't apply to API writes).
- Note attachments are set at create only; no attach/detach endpoints.
- No rate limiting (single-user; revisit if that changes).
