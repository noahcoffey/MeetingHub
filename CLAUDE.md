# CLAUDE.md — Meeting Hub

Self-hosted, single-user web app for work meeting notes and action items.
This file is the short, durable orientation for anyone (human or AI) working in the repo.
`README.md` covers setup/deploy; `API.md` and `INGEST_API.md` document the HTTP surfaces.

## Stack

- **Next.js 15 (App Router) + TypeScript strict** — one deployable. Server components for UI,
  route handlers (`src/app/api/**`) for the API surface.
- **PostgreSQL** + **Drizzle ORM** (`postgres-js` driver). Migrations live in `/drizzle`, generated
  from `src/db/schema.ts`. Never hand-edit the DB; never hand-edit generated migration SQL.
- **Auth.js (NextAuth v5)**, JWT sessions, single seeded user. Three Credentials providers in
  `src/auth.ts`: **password** (bcryptjs; auto-disabled once a passkey is registered), **passkey**
  (WebAuthn via `@simplewebauthn`), and one-time **recovery codes**. Brute-force throttling per IP
  (`src/lib/login-throttle.ts`).
- **ICS feed import** (`ical-expander`) — fetches each workspace's published `.ics` URL
  (`workspaces.ics_url`, edited under Settings → Workspaces; the legacy `CALENDAR_ICS_URL` env var
  is adopted into the default workspace by `db:migrate`, then unused) and upserts that day's
  events. (Replaced the original Google Calendar/OAuth approach — the target use case is an
  Outlook published feed.)
- Deployed on **Dokploy** via the `Dockerfile`; Postgres is a managed Dokploy service.

## Layout

- `src/db/` — `schema.ts` (Drizzle tables), `index.ts` (db client), `migrate.ts`, `seed.ts`.
- `src/app/` — routes. `api/health` is public; everything else is auth-gated.
- Notes editor: `meetings/[id]/markdown-editor.tsx` is a TipTap (ProseMirror) live
  markdown editor; `notes-editor.tsx` wraps it with the offline autosave/draft/conflict logic. Notes
  round-trip as a markdown string via `tiptap-markdown`, so the persistence layer is editor-agnostic.
- `src/auth.ts` — NextAuth providers (db + bcrypt). `auth.config.ts` — edge-safe config shared with
  middleware. `middleware.ts` — does route gating **plus** the CSRF cross-origin write check and the
  production CSP (per-request nonce + `strict-dynamic`); auth/health/ingest/webauthn-authenticate are
  excluded from the matcher.
- `src/lib/` — server logic, kept out of route handlers: `meetings.ts`, `action-items.ts`, `journal.ts`,
  `projects.ts` (+ `project-links.ts`), `notes.ts`, `people.ts`, `task-dependencies.ts`, `dashboard.ts`,
  `ics-calendar.ts`, `ingest.ts`, `search.ts`, `webauthn.ts`, `login-throttle.ts`, `dates.ts`,
  `google-auth.ts` (shared Google OAuth plumbing) + `google-calendar.ts` / `google-drive.ts` +
  `drive.ts` (Drive folder hierarchy/protection — see "Drive files" below).
- `src/app/(app)/` — the authed UI: Dashboard landing page (`page.tsx`, aggregates via
  `lib/dashboard.ts`, auto-refreshes every 60s), day meeting workspace (`meetings/` + `meetings/[id]`),
  `projects/` (list + `[id]` hub page), `people/` (list + `[id]` hub: matched meetings, agenda
  queue, waiting-on, linked titles), `notes/` (list + `[id]` full-page editor with an
  attachments rail), `journal/`, `tasks/` (Open/Completed/Dependencies views;
  Open supports Group By due date/created/project/priority/waiting, plus a collapsed
  "Scheduled & snoozed" section), `reports/` (charts over journal meta, completed action items +
  meeting load), and `settings/` (`security`, `incoming` notes review, `hidden` titles,
  `skipped` meetings, and a hidden `advanced` screen whose nav item only shows while holding "A" —
  its toggles hide all generated notes/Notes+ references incl. the Incoming screen, and anxiety
  (journal Meta scale, dashboard card, reports chart), backed by the `app_settings` key/value table
  via `lib/app-settings.ts`). Route-group
  `loading.tsx`/`error.tsx`/`not-found.tsx` boundaries live at the
  `(app)/` root; deleting an action item shows an Undo toast for 5s before the DELETE fires.
- `drizzle/` — generated migrations (committed).

## Commands

- `npm run dev` — local dev (defaults to :3000; pass `PORT=` if taken).
- `npm run typecheck` / `npm run lint` — run both before every commit.
- `npm test` (Vitest, `vitest run`) — integration tests for the `/api/v1` surface + `lib/api-tokens`,
  calling route handlers directly against a `meetinghub_test` database (auto-created/migrated by
  `tests/global-setup.ts` in the local docker Postgres). `tests/helpers.ts` mints tokens + invokes
  handlers; `truncate` resets between tests. Needs the dev Postgres up. `npm run test:watch` to watch.
- `npm run test:e2e` (Playwright, Chromium) — browser E2E of the API-token UI. `tsx e2e/setup-db.ts`
  creates/migrates/seeds a `meetinghub_e2e` DB (user with a known password) and Playwright boots a
  real `next dev` on :3100 against it (env overrides `.env.local`), then drives login → Settings →
  API tokens → create/use/revoke. `e2e/*.spec.ts`; config in `playwright.config.ts`. Needs the dev
  Postgres up + `npx playwright install chromium` once.
- `npm run db:generate` — regenerate migrations after editing `schema.ts`.
- `npm run db:migrate` / `npm run db:seed` — apply migrations / seed the single user.
- `npm run db:studio` — Drizzle Studio. `npm run auth:reset` — break-glass: re-enable password login
  and clear lockout (use if locked out after enabling passkeys).
- Local Postgres: `docker compose -f docker-compose.dev.yml up -d`.

## Data model

Defined in `src/db/schema.ts`. Core tables:

- `workspaces` — top-level partition of ALL content by life area (e.g. Work/Consulting/Community/…).
  Every content table below carries `workspace_id NOT NULL` (FK `restrict`): projects, people,
  meetings, notes, journal_entries, action_items, hidden_meeting_titles. Join/child tables
  (project_links, person_meeting_titles, note_*, task_dependencies, agenda_items) inherit scope via
  their parent; `pending_ingests` is deliberately global (workspace assigned at review). Uniques are
  composite per workspace: `(workspace_id, email)` people, `(workspace_id, calendar_event_id)`
  meetings, `(workspace_id, entry_date)` journal, `(workspace_id, title)` hidden titles. Exactly one
  row `is_default` (partial unique); fixed id `DEFAULT_WORKSPACE_ID`, seeded as "Personal" in
  migration 0022. Optional `ics_url` per workspace (a workspace setting; no env fallback).
  The **active workspace** is the `mh_workspace` httpOnly cookie, read only through
  `lib/workspace-context.ts` (`getActiveWorkspace[Id]()`, React-`cache()`d, falls back to default);
  set by `POST /api/workspaces/active`. Convention: scoped list/aggregate/create lib functions take
  `workspaceId` as FIRST param (resolved at the page/route boundary); by-id get/update/delete stay
  id-only, and by-id detail pages scope their rail/fan-out queries by the fetched row's own
  `workspaceId` (deep-link safe). Cross-workspace note attaches and task-dependency edges are
  rejected in the lib layer. Switcher UI: the MH mark in the sidebar (`workspace-switcher.tsx`);
  CRUD under Settings → Workspaces (delete is guarded: default or non-empty workspaces refuse).
  **Feature toggles**: `disabled_features` jsonb (the DISABLED set — empty = full app; keys in
  `WORKSPACE_FEATURES`: calendar|meetings|projects|people|notes|journal|reports|files; Tasks +
  dashboard always on). Enforced via `isFeatureEnabled()` in: SideNav filtering, `redirect("/")`
  guards on the list pages (detail pages stay deep-linkable), dashboard (`getDashboardData(workspace)`
  skips disabled queries — journal off means no auto-created entry — and returns `features` for
  section hiding), search (skips disabled groups), the meetings-page import button, a 403 on
  `/api/calendar/import`, and the `/api/drive/*` file routes (+ the project hub hides its Files
  tab). Toggled per row under Settings → Workspaces.
- `users` — single seeded user; `password_enabled` flag flips off once a passkey is registered.
- `webauthn_credentials` / `recovery_codes` — passkeys and one-time recovery codes for that user.
- `projects` — larger initiatives that group meetings and tasks (`status` active|archived with
  `archived_at`, optional `deadline`). Child table `project_links` (saved URLs; content type
  inferred from the URL at render time, not stored; icons are site favicons proxied via
  `/api/favicon`, glyph fallback). Links carry an optional `drive_folder_id` placing them inside
  the project's Drive folder tree — the hub's unified **Files & Links** tab and overview card show
  folders/files (Drive) and links (Postgres) as one collection; a standalone Links tab exists only
  when the `files` feature is off. Dead placements self-heal to the top level (base listing checks
  + re-home on app-side folder trash). Deleting a project detaches (`set null`) its
  meetings/tasks; links cascade.
- `project_milestones` — named checkpoints within a project (`name`, optional `due_date`, manual
  `completed_at`; FK cascade; no workspace_id — inherits via the project). Tasks link via
  `action_items.milestone_id` (set null); progress (done/total linked tasks) is computed at read
  time in `lib/milestones.ts`. Lib guard: assigning a milestone to a project-less task auto-adopts
  the milestone's project, a true mismatch 400s, and changing/clearing a task's project drops the
  link; recurrence spawns inherit the milestone. Surfaces: hub Milestones tab (slim underbar rows)
  + overview log nodes, /projects runway flag markers (rows include deadline-less projects with
  dated milestones), table "Milestone" column, dashboard `nextCheckpoint` (sooner of deadline vs
  milestone). Undated milestones are hub-only; completed ones are excluded from all aggregates.
  The milestone picker in `ActionItemsList` renders only when a `milestones` prop is passed (the
  hub tasks tab).
- `notes` — first-class reference notes: `title` + markdown `notes` body with `notes_updated_at`
  (same autosave/conflict contract as meeting/journal notes, so the shared `NotesEditor` is reused).
  Join tables `note_projects` / `note_meetings` (composite PK, FKs cascade) attach a note to any
  number of projects and meetings; deleting either side removes only the attachment. Top-level
  `/notes` list + `/notes/[id]` full-page editor whose rail manages attachments (projects via
  select, meetings via `/api/search` type-ahead) — the project hub and meeting rail list attached
  notes. Replaced the old `project_notes` running log (migrated in `0016`, dropped in `0017`).
- `meetings` — core unit. Keyed for calendar/ingest join via `calendar_event_id`.
  `notes` (markdown) + `notes_updated_at` (for offline-draft conflict checks). `notes_generated`
  holds AI notes pushed via `/api/ingest`; `external_ref` is the source app's stable id once matched. `source`:
  calendar|manual; `skipped` hides one occurrence; nullable `project_id`.
- `action_items` — flexible task entity, FK to a meeting OR a journal entry (both nullable = standalone),
  plus nullable `project_id`. `owner`/`owner_name` columns exist but the UI no longer exposes them
  (single-user: items are always "me"); `status` open|done with `completed_at` (powers the reports
  "completed/day"), `due_date` (hidden behind a calendar-icon popover), `priority` (1=high 2=medium
  3=low, null=unset; flag-icon popover, and a Group By mode on Tasks). Recurrence: `recurrence_unit`
  (day|weekday|week|month|year) + `recurrence_interval` ("every N units"; repeat-icon popover with
  presets). Completing a recurring item spawns the next open occurrence (due-date math in
  `lib/recurrence.ts` — advances from the old due date to keep the anchor, never lands ≤ today) and
  moves the rule onto it, so the done row is a plain historical record. Recurring occurrences with
  a future due date are **hidden from all open lists and counts** until their date arrives
  (`listOpenActionItems`/`getTaskCounts` exclude them); they're visible under a collapsed
  "Scheduled" section on the Tasks page via `listScheduledActionItems`. `category` exists but is
  unused — reserved for a future task-manager merge.
- `people` / `person_meeting_titles` — people (or forums) the user meets with. A meeting belongs
  to a person when its attendees contain the person's `email` (lowercased) OR its exact title is
  linked; matching is **computed at read time, never stored** (ICS sync clobbers attendees).
  `lib/people.ts` holds CRUD, matching (`matchPeopleForMeeting`, `listMeetingsForPerson`), and the
  agenda queue.
- `agenda_items` — "raise this with X next time": FK to a person (cascade); open = `discussed_at`
  IS NULL. Surfaces in the rail of any matched meeting; checking off records `discussed_meeting_id`
  (set null on meeting delete) and the person page keeps the history.
- Action-items extras: `snoozed_until` hides a task from all open lists/counts until the date
  (cleared on complete/reopen; visible under Tasks → "Scheduled & snoozed", like not-yet-due
  recurring occurrences). Waiting-on: an item is waiting iff `owner = 'other'`, with the who as
  `waiting_on_person_id` (FK people, set null) or free-text `owner_name`; the lib derives `owner`
  from those two (`normalizeWaiting`). Shared `toClientItem` mapper lives in
  `(app)/action-item-mapper.ts`.
- Meeting rail sections (top to bottom): Agenda (matched people's queue) · From last time (open
  items from earlier same-title occurrences) · Action items · Notes · Description.
- `task_dependencies` — directed edge: `task_id` depends on `depends_on_id`. Both FKs cascade
  (an edge dies with either task). `lib/task-dependencies.ts` rejects self/duplicate/cycle edges
  server-side; the Tasks → Dependencies view is drag-to-connect, and blocked tasks (open
  prerequisites) get a stop icon in the shared list.
- `journal_entries` — one per calendar day per workspace. `notes` autosaves like meeting notes; optional meta
  (`productivity`, `anxiety` — 5-point labeled scale in the UI; `wins`, `learnings`) feeds the
  reports charts.
- `pending_ingests` — ingest pushes that didn't match a meeting; reviewed under Settings → Incoming.
- `hidden_meeting_titles` — exact-title hide rules applied to the calendar list.
- Action-items UI: `(app)/action-items-list.tsx` is the shared client list — shows ALL open items.
  Default grouping is **this meeting/entry → overdue → due today → this week → next week → later
  (incl. undated)** (the meeting rail passes `currentMeetingId`, the journal rail
  `currentJournalEntryId`); a `groupBy` prop switches to created-day, due-date
  (Today / This week / Later), or per-project groups. Rows show a project-name prefix and a
  blocked icon when the task has open dependencies. The meeting detail is a 3-pane workspace:
  sidebar · edge-to-edge notes pane · full-height action rail.

## Conventions

- TypeScript strict; no `any` without a justifying comment.
- Keep components small; colocate route handlers under `src/app/api/`.
- **Never log** note bodies, action-item content, or attendee data — real work content.
- All secrets in env (`.env.local` for dev, Dokploy env for prod). See `.env.example`.
- Schema is designed so future additions (embeddings, transcripts, note ingest, a task manager)
  are *additive*, never a rewrite. Don't add those tables/columns now, but don't block them.

## Search

Unified ⌘K palette (`(app)/command-palette.tsx`, global) over `GET /api/search` → `src/lib/search.ts`.
Postgres-native: full-text (`to_tsquery` prefix + `ts_rank`) hybrid with `pg_trgm` `word_similarity`
fuzzy, across meeting title/notes/notes_generated/description + action-item content + project
name/description + note title/body — always scoped to the active workspace. `pg_trgm` enabled
via migration `0004`. Query-time tsvector (no indexes yet — fine at single-user scale).

## Note ingest API

`POST /api/ingest` (bearer `INGEST_API_KEY`, excluded from session middleware) lets an external
client push AI-generated notes. Matches `sourceId` (iCal UID) against `meetings.calendar_event_id` OR `external_ref`;
writes `notes_generated` **only if empty**; unmatched pushes stage in `pending_ingests` for review under
**Settings → Incoming notes** (match to a meeting → sets `notes_generated` + `external_ref`, or create new).
Matching is global across workspaces; an optional `workspace` field (the source app's workspace name,
matched case-insensitively against `workspaces.name` — keep names aligned between the apps) breaks
match ties toward that workspace and pre-tags unmatched pushes (`pending_ingests.workspace_id`,
set-null FK; raw hint kept in `workspace_hint` for display). Review: match-to-meeting inherits the
meeting's workspace (the picker lists the tagged workspace's meetings via `/api/meetings?workspace=`),
create-new uses the tag, falling back to the active workspace for untagged items. The Incoming
inbox/badge stays global. Generated notes render in a collapsible, editable section below the meeting notes. Full
contract for the client side: `INGEST_API.md`.

## MCP connector

`/api/mcp` (`src/app/api/[transport]/route.ts`, mcp-handler, streamable HTTP, stateless — SSE
disabled) is a remote MCP server for claude.ai custom connectors and other MCP clients. Every tool
in `lib/mcp-tools.ts` is a thin in-process proxy over the matching `/api/v1` route handler (invoked like
`tests/helpers.ts` does), forwarding the caller's bearer — auth/scope/workspace/feature enforcement
stays in the v1 layer. Auth is OAuth 2.1 (required by claude.ai): a minimal built-in authorization
server — discovery under `src/app/.well-known/`, DCR at `/api/oauth/register` (public clients,
PKCE S256 only), consent at `/oauth/authorize` (session-gated page; approval is a server action
returning the redirect URL so the CSP's `form-action 'self'` isn't tripped), token exchange at
`/api/oauth/token`. Clients/codes live in `oauth_clients`/`oauth_codes` (`lib/oauth.ts`; codes are
single-use — burned even on a failed exchange). A successful exchange mints a regular `api_tokens`
row named after the client, so **Settings → API tokens is the revocation surface**. The MCP + OAuth
endpoints and `.well-known` are excluded from the middleware matcher; the consent page deliberately
is not. Watch out: mcp-handler globally augments `Request` with `auth`, which is why
`lib/webauthn.ts` types request params structurally (`{ headers: Headers }`).

## Drive files

Per-workspace file storage backed by the user's own Google Drive (`drive.file` scope — the app
only sees files it created; no metadata mirror in Postgres, Drive is the source of truth). OAuth
reuses the calendar client via shared `lib/google-auth.ts`; a separate connect/callback pair at
`/api/drive/google/*` designates ONE global Drive account via `app_settings` keys
(`drive_account_id`, `drive_root_folder_id`) — Settings → Drive files is the connect/disconnect
surface (disconnect only clears the keys; the `google_accounts` row may still serve calendar).
Folder tree: `MeetingHub/<Workspace>/{Files,Projects/<Project>,Projects/_archived}`; only folder
IDs are stored (`workspaces.drive_*_folder_id`, `projects.drive_folder_id`), lazily created and
self-healing (stored id 404/trashed → recreate) via `ensure*` in `lib/drive.ts`. `lib/google-drive.ts`
is the raw v3 REST client. Routes under `/api/drive/` (session-gated, inside the middleware
matcher): files list/upload (multipart, buffered, `DRIVE_MAX_UPLOAD_MB` cap, resumable to Drive),
folders create (409 on sibling dup), rename/trash, download (server-proxied stream — prod CSP
blocks browser→googleapis). Guard rails on every mutation: target ∉ `managedFolderIds()` (403) and
`assertInTree()` parent-walk under the request's base folder (404). UI: shared
`(app)/files/file-browser.tsx` used by the `/files` page (workspace `Files/` area) and the project
hub Files & Links tab (`?projectId=` scopes to the project's folder, deep-link safe). Project
listings merge in `project_links` placed by `drive_folder_id` (null = base level), and when Drive
is unavailable the project view degrades to a links-only list (`drive:` key in the GET response)
instead of erroring. Lifecycle: project delete moves its folder to `_archived/`, project/workspace
rename best-effort renames the Drive folder (`try*` helpers never throw; logs ids only). No v1/MCP
exposure yet (follow-up).

## Out of scope (do not build)

AI synthesis/digests (note ingest is built; *generating* notes here is not), task-manager migration,
semantic/vector search, bidirectional links/graph, multi-user/sharing.

## Companion docs

`README.md` (setup/deploy), `API.md` (`/api/v1` token API), `INGEST_API.md` (note-ingest push contract).
