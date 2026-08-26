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
  `drive.ts` (Drive folder hierarchy/protection — see "Drive files" below),
  `summaries.ts` + `summary-context.ts` (Sunday-Summary storage + the week-context aggregate).
- `src/app/(app)/` — the authed UI: Dashboard landing page (`page.tsx`, aggregates via
  `lib/dashboard.ts`, auto-refreshes every 60s), day meeting workspace (`meetings/` + `meetings/[id]`),
  `projects/` (list + `?view=parked` idea shelf + `[id]` hub page, whose tabs include a **Map** of
  project↔project relations), `map/` (the workspace graph as a full-height, client-driven app
  surface — main nav, under the `projects` toggle), `people/` (list + `[id]` hub: matched meetings, agenda
  queue, waiting-on, linked titles), `notes/` (list + `[id]` full-page editor with an
  attachments rail), `journal/`, `tasks/` (Open/Completed/Dependencies views;
  Open supports Group By due date/created/project/priority/waiting, plus a collapsed
  "Scheduled & snoozed" section), `reports/` (charts over journal meta, completed action items +
  meeting load), `summaries/` (weekly Sunday-Summary briefings, rendered read-only via
  `MarkdownView`; always in the nav — per-workspace enablement lives in the runner's config,
  not an app toggle), and `settings/` (`security`, `incoming` notes review, `hidden` titles,
  `skipped` meetings, and a hidden `advanced` screen whose nav item only shows while holding "A" —
  its toggles hide all generated notes/Notes+ references incl. the Incoming screen, and anxiety
  (journal Meta scale, dashboard card, reports chart), backed by the `app_settings` key/value table
  via `lib/app-settings.ts`). Route-group
  `loading.tsx`/`error.tsx`/`not-found.tsx` boundaries live at the
  `(app)/` root; deleting an action item shows an Undo toast for 5s before the DELETE fires.
- **Mobile chrome** (≤820px): the sidebar's nav hides and a native-style bottom tab bar takes over
  (`(app)/mobile-tab-bar.tsx` — Dashboard/Meetings/Tasks/Projects + a "More" sheet; item defs
  shared with `side-nav.tsx` via `(app)/nav-items.tsx`; feature-toggle filtered). The app is an
  installable PWA: `src/app/manifest.ts` (standalone display; `manifest.webmanifest` is excluded
  from the middleware matcher) + `public/icon*.svg`, `appleWebApp` meta and safe-area-inset CSS in
  the root layout/globals. Touch rules live at the end of `globals.css` (16px root type and
  16px inputs ≤820px, hover-revealed controls forced visible under `@media (hover: none)`).
  The page must never be wider than the viewport there — horizontal overflow makes the whole app
  pannable and drags the sticky top bar off screen with it — so `html` is `overflow-x: clip`
  ≤820px and dense rows (meeting rows, task meta pills, segmented toggles, detail title rows)
  wrap instead of shrinking. Verify new mobile layout at 320/360/390px, not just 390.
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
- `projects` — larger initiatives that group meetings and tasks (`status` active|archived|**parked**
  with `archived_at`, optional `deadline`). **parked** = an idea captured mid-meeting that isn't a
  real initiative yet; promoting it is a status flip. `listProjects` filters on an explicit status
  allow-list (`includeArchived` / `includeParked`, neither = active only), which is the single
  choke point keeping parked rows out of /projects, the dashboard, project pickers,
  `getProjectSummaries` and the Sunday-Summary context. Search deliberately DOES return them,
  flagged `parked: true` (⌘K shows a "Parked idea" subtitle). Shelf at `/projects?view=parked`. Child table `project_links` (saved URLs; content type
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
- `project_relations` — directed edge between two projects, `kind` related|blocks|depends_on|spun_from
  (default `related`), optional `note`, plus `created_in_meeting_id` (set null) recording which
  meeting the connection was raised in. Both project FKs cascade; no workspace_id — scope inherits
  from the endpoints (`lib/project-relations.ts` rejects self/duplicate/cross-workspace edges, and
  **one edge per pair regardless of direction** — flipping or retyping goes through `updateRelation`).
  Cycle checks apply ONLY to the two *flow* kinds, normalized so `blocks(A,B)` and `depends_on(B,A)`
  are the same arrow; `related`/`spun_from` are unconstrained. The lib checks can be raced, so
  migration **0038** (hand-written, like 0004's pg_trgm — not mirrored in `schema.ts`) adds a
  no-self-edge CHECK and a unique index on `(LEAST(from_id,to_id), GREATEST(from_id,to_id))`;
  `addRelation` maps a `23505` back to `duplicate` (Drizzle wraps driver errors, so the code sits on
  `cause`). `captureRelatedProject` runs the project insert and the edge in **one transaction**.
  Session routes taking a `projectId` authorize through the shared `api/_lib/project-guard.ts`
  (exists → workspace → `projects` feature); relation PATCH/DELETE resolve the edge first and guard
  via its `fromId`, since an edge id alone carries no scope. Surfaces: the meeting rail's
  **Related projects** section (type-ahead to link an existing project, or type a new name to
  create a parked project + edge in one request via `POST /api/project-relations/capture`) and the
  project hub's **Map** tab (`projects/project-map.tsx` — a small radial preview, links out to the
  real thing). No v1/MCP exposure yet.
- **Graph rendering** is **React Flow** (`@xyflow/react`, MIT), shared by both graph surfaces via
  `(app)/project-graph.tsx` (the custom `project` node + `project` edge, the arrowhead `<defs>`, and
  the legend) and `(app)/project-graph-state.ts` (bubble colour: overdue / due soon ≤7d / active /
  parked — the same urgency buckets `/projects` uses, off the `deadline` the payload already
  carries). Both queries filter archived projects out, with one exception: `getProjectMap` keeps the
  **centre** whatever its status, so an archived project's own Map tab still renders. That is the
  only way the `archived` state reaches a bubble, which is why it's absent from `GRAPH_STATES` and
  the hub passes it to `GraphLegend` explicitly. **React Flow renders and handles input; it
  never decides where a node goes** — the app's own layouts below produce positions and pass them in
  as controlled state, `nodesDraggable={false}` (nothing persists a manual position), and no
  simulation runs. Nodes use `nodeOrigin={[0.5, 0.5]}` so a layout point *is* the bubble's centre.
  The custom edge reads live node positions via `useInternalNode` and trims the line to the bubble's
  ellipse, which is what lets edges track a tween frame by frame.
- **`/map`** (`(app)/map/map-workspace.tsx`) is the app-like surface for the graph. Shape to
  preserve when touching it:
  - **Two modes off one `focusId` state.** `null` = **overview**, the default: every project in the
    workspace, connected or not, as one board — connected components as constellations up top,
    single unconnected projects packed into rows beneath, the whole composition vertically centred.
    Set = **focus**, a two-hop radial around one project. In overview a click only *selects* (opens the panel) so the board never moves under
    you; centring is explicit (panel button, double-click, or the Jump box), and "‹ Everything"
    goes back. In focus mode a click re-centres.
  - **One server load, then no navigations.** The page ships the whole workspace graph; every mode
    change is state, so the URL never changes. `?focus=` only seeds the starting node.
  - **The page never scrolls; the canvas does.** A ResizeObserver feeds the live pixel box into the
    layout so the graph *opens* already fitting the stage, and React Flow then pans/zooms the
    viewport over it (Controls has the fit-view button). The stage clips its own overflow — nothing
    may make the surrounding page scrollable, horizontally least of all, or the sticky top bar goes
    with it. Full-screen is the browser Fullscreen API on the stage.
  - **Positions are tweened** (rAF + easeInOutCubic, ~380ms). The interpolated points are fed into
    React Flow's controlled `nodes` and the custom edge derives its path from live node positions,
    so lines travel with their nodes. Don't swap the tween for a CSS transition on
    `.react-flow__node` — edges would snap while nodes glide.
  - **Geometry lives in `(app)/project-graph-layout.ts`** — pure, React-free, unit-tested in
    `tests/lib/project-graph-layout.test.ts`. Each component is a **radial spanning tree**: BFS from
    the best-connected project, each node owns an angular wedge, children carve their slice out of
    the parent's wedge in proportion to subtree leaf count. That is what keeps a project's
    satellites next to *it* rather than spread around a shared ring — the old single-ring-per-
    component layout sent a node's own satellites to the far side and their edges crossed the
    middle as chords. Non-tree edges still draw; they just don't decide position. Components are
    arranged by the chosen **arrangement**, and focus mode is the same tree rooted on `focusId` and
    cut to two hops.
  - **Arrangement** is how whole constellations sit relative to each other, independent of the tree
    inside them. `scatter` (the default) drops each component — a lone project is a component of one
    — onto a **golden-angle spiral**: turn ~137.5°, step out by √i. That angle is irrational against
    a full turn, so every item gets its own direction out from the centre and the sequence never
    repeats; the board stops resolving into the rows and columns the old packed layout produced.
    (A strong tendency, not a coordinate guarantee — two items on different spokes can still share
    an x. The test asserting this is explicitly a heuristic.) Busiest constellations sort first and
    land centrally; loose projects drift outward. The spiral evens out *density*, not clearance, so
    each item is nudged along its own angle until it clears what's placed, falling back to a
    provably-clear radius if that stepping runs out — deterministic, no relaxation pass, no
    simulation. `shelf` is the old packed rows, kept for comparison and selectable in the palette.
  - **Ring radius grows with crowding.** A fixed `depth × RING_GAP` cramped a busy ring: thirty
    direct relations each get a sliver of angle, and at a fixed radius the bubbles overlap. Arc
    length is wedge × radius, so each ring is pushed out until its thinnest wedge is worth a whole
    bubble, kept monotonic so a child never lands inside its parent's ring.
  - The layout tests encode the complaints directly — a satellite must be nearer its own parent than
    any other, and bubbles must never overlap — so keep them honest.
  - **Bubbles are uniform circles** (`--pg-size` on `.pg-node`), name centred and wrapped over up to
    three lines — the old pill clipped anything past ~18 characters to an ellipsis. Uniform size is
    deliberate: bubbles that grow to fit their text imply a hierarchy of importance the data doesn't
    have. The open-task count moved to a corner pill and the connector handle to the rim, so neither
    fights the label for the centre. `RING_GAP`/`SQUASH` in the layout module are tuned to this size
    (circles need nearly as much vertical room as horizontal, unlike the old wide-short pills) —
    changing `--pg-size` means revisiting them.
  - **The viewport frames the composition; the layout doesn't fight to fit it.** After a full
    relayout `fitView` runs once the tween has settled — late enough that it reads final positions
    *and* that the side panel has already narrowed the canvas, so nothing ends up parked behind the
    panel. Selecting, connecting and disconnecting never move the viewport.
  - **A full relayout is an event, not a reaction.** `targets` is state. It recomputes on mount,
    overview↔focus, resize and the **Tidy** button — and on nothing else. Adding a project,
    connecting or disconnecting leaves every existing bubble where it is; a new node is hung off its
    neighbour by `placeNear` into the emptiest direction. Rearranging the whole board when one node
    appears reads as a page reload, which is exactly what this avoids.
  - **Nothing transient may be a layout input.** The ResizeObserver measures `.mapx-body`, never
    `.mapx-canvas` (the side panel narrows the canvas), and the error + connect banners are
    absolutely positioned *inside* the body rather than stacked above it — as normal-flow siblings
    they shrank the stage and the board jumped every time one appeared.
  - **React Flow renders a re-created node un-hittable for a frame**, which silently eats the second
    click of a double-click. Hence: selection rides in node `data` as `isSelected`, **never** React
    Flow's `selected` prop; `elevateNodesOnSelect` is off; and `onNodeActivate`/`onPaneActivate`
    detect the double click themselves — two clicks on one id inside 400ms, *and* a pane click that
    soon after a node click is treated as the swallowed second half of the gesture rather than
    "clicked away". Without that last fallback, double-click-to-centre silently deselects instead.
    All of it is covered in `e2e/project-relations.spec.ts`; it has regressed before.
    (The side panel was briefly an absolute overlay to dodge the canvas resize — it covered the
    right-hand bubbles and swallowed their clicks. Don't retry that.)
  - In focus mode, two hops max, and the outer ring fans around **its own parent's angle** so an
    edge reads as a branch instead of a chord through the centre. Anything further out is reached
    via the Jump box or by going back to the overview.
  - **Connecting works two ways in both modes**, both now React Flow's own gesture: drag a node's
    crosshair handle onto another, or *click* the crosshair to arm click-to-connect and click the
    target. The click path exists because a drag onto a small handle is easy to miss. React Flow
    keeps the armed source in an internal store field that **nothing clears but clicking a second
    handle** — no Esc, no cancel on a pane click — so `useClickConnect()` in `project-graph.tsx`
    owns the way out: it mirrors the armed node from `onClickConnectStart`/`End`, renders the
    `ConnectBanner` (with Cancel), binds Esc, and clears `connectionClickStartHandle` on the store.
    Don't drop that hook for "React Flow handles it" — it doesn't.
    Two more things in `project-graph.tsx` make the gesture forgiving: the whole bubble is a covering
    `target` handle with `isConnectableStart={false}`, which React Flow leaves at
    `pointer-events: none` until a connection is actually in flight — so it catches the drop
    anywhere on the node without swallowing ordinary clicks. And a finished click-connect still
    bubbles a click to the node underneath, so both surfaces hold a `justConnected` **ref** (not
    state — the click lands in the same event dispatch) to skip that select/navigate. Don't remove
    either guard.
  - The **side panel** opens on selection: header, connections (retype/disconnect/refocus inline),
    connect-or-create type-ahead, and open tasks with quick-add (content only — no due date,
    priority, or recurrence) via `GET/POST /api/action-items?projectId=` and a `status: done` PATCH.
    Node badges show open-task counts and update optimistically with the panel.
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
- Meeting rail sections (top to bottom): Agenda (matched people's queue) · Related projects
  (capture adjacent work; hidden when the `projects` feature is off, and shows a "tag this meeting
  to a project" hint when the meeting has no `project_id`) · From last time (open items from
  earlier same-title occurrences) · Action items · Notes · Description.
- `task_dependencies` — directed edge: `task_id` depends on `depends_on_id`. Both FKs cascade
  (an edge dies with either task). `lib/task-dependencies.ts` rejects self/duplicate/cycle edges
  server-side; the Tasks → Dependencies view is drag-to-connect, and blocked tasks (open
  prerequisites) get a stop icon in the shared list.
- `journal_entries` — one per calendar day per workspace. `notes` autosaves like meeting notes; optional meta
  (`productivity`, `anxiety` — 5-point labeled scale in the UI; `wins`, `learnings`) feeds the
  reports charts.
- `pending_ingests` — ingest pushes that didn't match a meeting; reviewed under Settings → Incoming.
- `hidden_meeting_titles` — exact-title hide rules applied to the calendar list.
- `weekly_summaries` — one AI-written "Sunday Summary" per workspace per week, keyed unique
  `(workspace_id, week_start)` (`week_start` = the Monday being prepped; FK restrict like other
  content tables). Generated OUTSIDE the app by `tools/sunday-summary` (a launchd-scheduled local
  runner) from `GET /api/v1/summary-context` (one aggregate in `lib/summary-context.ts` — disabled
  workspace features → null sections), pushed via upserting `PUT /api/v1/summaries`, rendered under
  `/summaries`. Which workspaces get summaries is the runner's config — no app-side toggle.
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
inbox/badge stays global. If a push lands on a meeting that was **skipped**, the day view surfaces it below the day's list
(`(app)/skipped-notes-banner.tsx`, fed by `listSkippedWithGeneratedForDate`) offering Restore
(the existing skip DELETE) or Move — `POST /api/meetings/[id]/move-notes` → `moveGeneratedNotes`,
which moves `notes_generated` in one transaction and points the ingest's re-match keys at the
target (`external_ref` ← the source's ref, falling back to its `calendar_event_id`; the target is
stamped a millisecond newer so it wins ingest's `updated_at` tie-break), refusing cross-workspace
targets or a target that already has generated notes. A day whose only content is such a meeting stays on the day view instead of auto-flipping to
month. Generated notes render in a collapsible, editable section below the meeting notes. Full
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

AI synthesis/digests **inside the app** (note ingest and weekly-summary storage/serving are built;
*generation* always happens outside — AI notes are pushed via `/api/ingest`, and the Sunday
Summary is produced by the local agent in `tools/sunday-summary` and pushed via
`PUT /api/v1/summaries`; never add an LLM dependency or scheduler to the app), task-manager
migration, semantic/vector search, multi-user/sharing.

Note: a project↔project graph **is** built now (`project_relations` + the hub's Map tab) — it
replaced the former "bidirectional links/graph" entry on this list. That decision is scoped to
*projects*: a general wiki-style backlink graph across notes/meetings is still out.

## Companion docs

`README.md` (setup/deploy), `API.md` (`/api/v1` token API), `INGEST_API.md` (note-ingest push
contract), `tools/sunday-summary/README.md` (the local Sunday-Summary agent: config, manual runs,
launchd schedule).
