# Meeting Hub API (v1)

Programmatic access to tasks, meetings, projects, milestones, and notes via
`/api/v1/*`. Authenticated with scoped bearer tokens created under
**Settings → API tokens** (the note-ingest push contract is separate — see
`INGEST_API.md`).

Prefer tools over raw HTTP? The same surface is exposed as a remote **MCP
server** at `/api/mcp` (streamable HTTP + OAuth) — see the "MCP connector"
section in `README.md`. MCP tool calls are proxied through these v1 endpoints,
so everything below (scopes, workspace rules, error shapes) applies there too.

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
| GET | `/api/v1/projects?workspace=&includeArchived=true&includeParked=true` | Active only by default; each flag adds that status |
| POST | `/api/v1/projects?workspace=` | `{ name, description?, deadline? }` |
| GET | `/api/v1/projects/:id` | |
| PATCH | `/api/v1/projects/:id` | `{ name?, description?, deadline?, status? }` (`active`/`archived`/`parked`) |
| GET | `/api/v1/projects/:id/milestones` | Includes task progress counts |
| POST | `/api/v1/projects/:id/milestones` | `{ name, dueDate? }` |
| GET | `/api/v1/milestones/:id` | |
| PATCH | `/api/v1/milestones/:id` | `{ name?, dueDate?, completed? }` |
| GET | `/api/v1/notes?workspace=` | Summaries (title, attached projects, meeting count) |
| POST | `/api/v1/notes?workspace=` | `{ title?, body?, projectId?, meetingId? }` (same-workspace attach at create only) |
| GET | `/api/v1/notes/:id` | Full row; body is in `notes` |
| PATCH | `/api/v1/notes/:id` | `{ title?, body? }` |

Notes carry a `shared` boolean (the note is published at a public `/s/<slug>` URL). The slug itself
is deliberately **never served over the API** — it grants read access to anyone holding it — and
there is no endpoint to turn sharing on or off; that lives in the app UI only.
| GET | `/api/v1/summary-context?workspace=&weekStart=` | Aggregate week payload for the Sunday-Summary runner |
| GET | `/api/v1/summaries?workspace=` | Weekly summaries, meta only (no markdown), newest week first |
| PUT | `/api/v1/summaries?workspace=` | Upsert a summary by `(workspace, weekStart)` — 201 created / 200 overwritten |
| GET | `/api/v1/summaries/:id` | Full row incl. `markdown` |
| GET | `/api/v1/day-summary-context?workspace=&date=` | One day's meeting-note payload for the Day-Summary runner |
| GET | `/api/v1/day-summaries?workspace=&from=&to=` | Day summaries, meta only (no bodies), newest day first |
| PUT | `/api/v1/day-summaries?workspace=` | Upsert a summary by `(workspace, date)` — 201 created / 200 overwritten |
| GET | `/api/v1/day-summaries/:id` | Full row incl. `markdown` and `markdownEdited` |
| PATCH | `/api/v1/day-summaries/:id` | `{ markdown }` — edit the body, or `null` to reset |

Responses: lists are `{ items: [...] }`, single rows `{ item: {...} }`,
creates return 201 (the upserting endpoints, `PUT /api/v1/summaries` and
`PUT /api/v1/day-summaries`, return 200 when they overwrite). Dates are ISO 8601; day-scoped fields (`dueDate`,
`deadline`) are `YYYY-MM-DD`.

Project↔project relations (`project_relations`) have **no v1 or MCP surface yet** — they're
reachable only through the session-gated `/api/project-relations` routes the app's own UI uses.

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

## Weekly summaries

Storage/serving for the **Sunday Summary** — an AI-written weekly briefing
generated *outside* the app by the local runner in `tools/sunday-summary`
(see its README). The app never calls an LLM; these endpoints just move data.
The daily counterpart is below.

- `weekStart` must be a **Monday** (`YYYY-MM-DD`) — it keys the summary to the
  week it prepares for. Non-Mondays 400.
- `GET /api/v1/summary-context` assembles everything the runner's prompt
  needs in one payload: week-ahead meetings/tasks/milestones, last week's
  completed tasks + meetings + journal excerpts, stale waiting-on items,
  agenda queues for people being met, and meeting-load trends. `weekStart`
  defaults to the Monday of *tomorrow*'s week. Sections for disabled workspace
  features are `null` (vs. `[]` = enabled but empty); no note bodies are
  included, journal notes are capped excerpts.
- `PUT /api/v1/summaries` upserts, so the runner can re-run safely:

```bash
curl -X PUT -H "Authorization: Bearer mh_..." \
  -H "Content-Type: application/json" \
  -d '{"weekStart": "2026-08-03", "markdown": "# Week of Aug 3\n...", "model": "claude-opus-5"}' \
  "https://<host>/api/v1/summaries?workspace=<uuid>"
```

Optional PUT fields: `model` (string), `generatedAt` (ISO datetime, defaults
to now).

## Day summaries

A **Day Summary** is a single synthesis of everything that happened across one
day's meetings, written from those meetings' manual and AI-generated notes. It
is not a digest of per-meeting summaries — its whole value is in the
connections no single meeting contains (a decision made in the morning
validated in the afternoon, a date that shifts between conversations, an
intention stated once and never confirmed again).

Like the weekly Sunday Summary, these endpoints are **storage and serving
only**. Generation happens outside the app, in the local runner at
`tools/day-summary` (see its README) — the app never calls an LLM.

- `date` is `YYYY-MM-DD` in `APP_TIMEZONE`, and buckets meetings exactly as the
  day view does. Any past day is allowed.
- `GET /api/v1/day-summary-context` assembles everything the runner's prompt
  needs in one payload: `dateLabel`, `meetingCount`, `totalTimeLabel` (the sum
  of scheduled durations, computed server-side so the model never has to add up
  time ranges), `inputFingerprint`, and per meeting its title, a pre-rendered
  `timeLabel`, attendees, manual `notes` **in full**, and `generatedSections` —
  **only** the Summary / Decisions Made / Action Items of its AI-generated
  notes. Full generated bodies are deliberately never served: they restate what
  those three carry, and passing them makes output worse, not better.
  A day where no meeting has notes returns **200** with `hasNotes: false` and an
  empty `meetings` array — not an error, so a nightly runner doesn't fail every
  quiet weekend.
- `PUT /api/v1/day-summaries` upserts by `(workspace, date)`, so the runner can
  re-run safely. Body: `date`, `markdown` (required), plus optional `model`,
  `generatedAt` (ISO datetime, defaults to now) and `inputFingerprint`.
- **`inputFingerprint` is stored exactly as sent, never recomputed on arrival.**
  The runner reads the context, spends minutes in the model, then pushes; notes
  routinely land in between. Recomputing would make a summary written from the
  old inputs look current — precisely the case staleness exists to catch. Omit
  it and the server computes one, which is the best it can do for a hand-rolled
  push. The day view recomputes and compares on load, flagging the summary as
  stale; nothing is ever silently regenerated.
- **Edits and regeneration are separate fields.** `markdown` is the runner's
  output and the only field `PUT` writes; `markdownEdited` is your hand-edited
  version and is what the app renders. A re-push never overwrites an edit.
  `PATCH {"markdown": null}` (or text identical to the generated body) clears
  the edit and falls back to the generated one — the generated body is not
  writable over the API.

```bash
# What the runner reads
curl -H "Authorization: Bearer mh_..." \
  "https://<host>/api/v1/day-summary-context?workspace=<uuid>&date=2026-09-14"

# What it pushes back
curl -X PUT -H "Authorization: Bearer mh_..." \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-09-14", "markdown": "**Monday...**", "model": "claude-opus-5", "inputFingerprint": "<from the context response>"}' \
  "https://<host>/api/v1/day-summaries?workspace=<uuid>"
```

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
