# Meeting Hub

A self-hosted, single-user web app that keeps your work meetings, notes, tasks, and projects in one
place — you own the data, and it works across desktop and phone.

- **Meetings** pulled from a calendar feed (a published `.ics` URL or Google Calendar), each with a
  live-markdown notes pad and a full-height action-item rail.
- **Tasks** with due dates, priorities, recurrence, dependencies, snooze, and waiting-on tracking —
  surfaced on a dashboard and a dedicated Tasks view.
- **Projects & milestones**, **people** with per-person agenda queues and waiting-on lists, a daily
  **journal** with user-definable stats, and **reports** charting your meeting load and trends.
- **Workspaces** partition everything by life area (Work, Consulting, Community…), and a **⌘K search**
  spans meetings, notes, tasks, and projects.
- Passkey-first sign-in, and a scoped-token **API** (plus an ingest endpoint for AI-generated notes)
  to wire it into the rest of your tools.

## Screenshots

**Dashboard** — your day at a glance: journal trends, open tasks, the next meeting, and this week's wins.

![Dashboard](docs/screenshots/dashboard.png)

**Meeting workspace** — live-markdown notes beside an action-item rail, with attendees, agenda, and
items carried over from the last time this meeting ran.

![Meeting notes](docs/screenshots/meeting.png)

**Projects** — milestones and open work per project, a deadline runway, and a triage inbox for
meetings and tasks that don't have a project yet.

![Projects](docs/screenshots/projects.png)

## Stack

Next.js 15 (App Router, TypeScript strict) · PostgreSQL · Drizzle ORM · Auth.js (NextAuth v5,
credentials) · ICS calendar feed import (`ical-expander`) · Docker / Dokploy.

## Local development

Prerequisites: Node 22+, Docker (for local Postgres).

```bash
# 1. Install deps
npm install

# 2. Start local Postgres
docker compose -f docker-compose.dev.yml up -d

# 3. Configure env
cp .env.example .env.local
#   - set AUTH_SECRET:        openssl rand -base64 32
#   - set SEED_USER_EMAIL / SEED_USER_PASSWORD
#   - DATABASE_URL already points at the docker Postgres above

# 4. Run migrations + seed the single user
npm run db:migrate
npm run db:seed

# 5. Start the app
npm run dev      # http://localhost:3000 (set PORT= if 3000 is taken)
```

## Environment variables

| Var | Required | Notes |
|-----|----------|-------|
| `DATABASE_URL` | yes | Postgres connection string |
| `AUTH_SECRET` | yes | Session signing secret (`openssl rand -base64 32`) |
| `SEED_USER_PASSWORD` | yes | **The login password.** Re-seeding (every deploy) rotates it. Use a strong one. |
| `SEED_USER_EMAIL` | yes | Identifier/display label only — shown in the sidebar; **not** used to log in |
| `CALENDAR_ICS_URL` | for calendar | URL of a published `.ics` feed (the URL itself is the secret) |
| `INGEST_API_KEY` | for note ingest | Bearer token for `POST /api/ingest` (external generated-notes push). See `INGEST_API.md` |
| `APP_TIMEZONE` | no | IANA tz for "today"/day boundaries. Defaults to `America/New_York` |
| `TRUSTED_PROXY_COUNT` | no | Reverse proxies in front of the app (for login-throttle client-IP derivation). Default `1`; set `0` if exposed directly. See [`SECURITY.md`](SECURITY.md) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for Google Calendar | OAuth client for connecting Google calendars (optional — `.ics` still works without it) |

## Database

- Schema lives in `src/db/schema.ts`. **Never hand-edit the DB.**
- After editing the schema: `npm run db:generate` to create a migration, then `npm run db:migrate`.
- Migrations are committed under `drizzle/` and run automatically on container start in production.

## Running tests

All tests need the local Postgres running (`docker compose -f docker-compose.dev.yml up -d`) — they
use dedicated `meetinghub_test` / `meetinghub_e2e` databases, created and migrated automatically.

```bash
npm test           # Vitest — integration + unit tests (src/lib + the /api surface)
npm run test:watch # …in watch mode
npm run coverage   # Vitest with a coverage report (text + coverage/index.html) and a CI threshold gate

npm run test:e2e   # Playwright — browser E2E; seeds meetinghub_e2e and boots `next dev` on :3100
```

E2E notes:

- One-time browser install: `npx playwright install chromium`.
- `npm run test:e2e` runs `e2e/setup-db.ts` first, then all specs. To run a single spec, prep the DB
  yourself first: `npx tsx e2e/setup-db.ts && npx playwright test <name>` (bare `playwright test`
  boots the app but skips the DB setup). Add `--headed` to watch, `--debug` to step through, or
  `npx playwright show-report` after a run.

CI runs typecheck, lint, build, the Vitest suite (with the coverage gate), and the Playwright suite
on every PR.

## Calendar import (ICS feed)

The app imports a day's events from a published **`.ics` feed** (e.g. Outlook's
*Settings → Calendar → Shared calendars → Publish a calendar* link, or any iCalendar URL). It fetches
the feed, expands the requested day, and upserts events into `meetings` — **idempotent** on the
calendar event id, and re-importing never overwrites your notes.

Setup is just one variable:

```
CALENDAR_ICS_URL=https://your-host/path/to/calendar.ics
```

The feed URL is effectively a bearer secret (anyone with it can read your calendar), so treat it like
one — set it via env, never commit it. Then the **Import calendar** button on the meetings list pulls
that day's events. If the variable is absent the button reports "Calendar feed is not configured" and
the rest of the app (manual meetings, notes, tasks) works normally.

Notes: recurring events are expanded to per-day instances. Some published feeds (Outlook included)
omit attendee lists for privacy — that's fine, the meeting just imports without attendees.

## Calendar import (Google Calendar)

As an alternative to an `.ics` URL, a workspace can pull directly from Google Calendar over OAuth.
It's opt-in and needs a one-time Google Cloud setup by whoever runs the server:

1. In the [Google Cloud console](https://console.cloud.google.com/): create a project, **enable the
   Google Calendar API**, configure the OAuth consent screen (External; scope
   `.../auth/calendar.readonly`), and create an **OAuth 2.0 Client ID** of type *Web application*.
2. Add the redirect URI `https://<your-host>/api/calendar/google/callback` (and
   `http://localhost:3000/api/calendar/google/callback` for local dev).
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the environment.

Then, in the app: **Settings → Calendars → Connect a Google account** (you can connect several, e.g.
work and personal). Under **Settings → Workspaces**, each workspace picks one calendar from any
connected account to import from — a chosen Google calendar takes precedence over that workspace's
`.ics` URL. Read-only access only; the refresh token is stored **encrypted at rest**. Import uses the
same idempotent, never-overwrite-your-notes path as the `.ics` importer.

## Security & data handling

See [`SECURITY.md`](SECURITY.md) for the full security model, deployment requirements
(trusted-proxy setup, `GOOGLE_REDIRECT_URI`, `INGEST_API_KEY` scope), and how to report a vulnerability.

- HTTPS only in production; all secrets in env vars, never committed.
- The app never logs note bodies, action-item content, or attendee data.
- **Single password login** (no username). The password is bcrypt-hashed (cost 12) and the session is
  a secure, signed, httpOnly cookie.
- **Brute-force protection** (`src/lib/login-throttle.ts`): after 5 failed attempts from an IP within
  15 minutes, that IP is locked out for 15 minutes (even a correct password is rejected during the
  lockout); a higher global threshold backstops IP-rotating attempts. Enforced in the auth layer, so
  it can't be bypassed by calling the credentials endpoint directly. State is in-memory (resets on
  restart, which only ever clears lockouts). bcrypt's slow compare further throttles guessing.

## Deploy (Dokploy)

The app ships as a single Docker image. Migrations and the user seed run automatically on container
start via `docker-entrypoint.sh` (both idempotent), so a deploy is just "push → build → run".

1. **Postgres service** — in your Dokploy project, create a **Postgres** service. Note its
   internal connection string (host is the service name on the Dokploy network, e.g.
   `postgres://USER:PASS@meetinghub-db:5432/meetinghub`).
2. **Application** — create an **Application** pointed at this GitHub repo. Build type: **Dockerfile**
   (repo root). Enable auto-deploy on push if desired.
3. **Environment variables** (Application → Environment):
   - `DATABASE_URL` → the Postgres service's internal connection string from step 1.
   - `AUTH_SECRET` → `openssl rand -base64 32`.
   - `SEED_USER_PASSWORD` → your **login password** (strong; re-seeded each deploy).
   - `SEED_USER_EMAIL` → any identifier for the sidebar label (not used to log in).
   - `APP_TIMEZONE` → e.g. `America/New_York` (optional; default is that).
   - `CALENDAR_ICS_URL` → your published `.ics` feed URL (optional — only for calendar import).
4. **Domain & HTTPS** — add the domain (e.g. `hub.example.com`) in the Application's Domains tab,
   container port **3000**, and enable HTTPS (Let's Encrypt via Traefik). HTTPS is required — the
   session cookie is `secure`. Point the domain's DNS at the Dokploy host first.
5. **Deploy.** On boot the container logs `[migrate] done.` and `[seed] …`, then `▲ Next.js … Ready`.
6. **Verify**: `https://yourdomain/api/health` returns `{"ok":true}` (this route is public). Then sign in.

### Building/running the image locally

```bash
docker build -t meetinghub .
docker run -p 3000:3000 \
  -e DATABASE_URL=postgres://meetinghub:meetinghub@host.docker.internal:5432/meetinghub \
  -e AUTH_SECRET=$(openssl rand -base64 32) \
  -e SEED_USER_EMAIL=you@example.com -e SEED_USER_PASSWORD=changeme \
  meetinghub
```

## Authentication & recovery

Sign-in is **passwordless-first**: register a passkey (YubiKey, Touch ID, Windows Hello, or a
password-manager passkey) under **Settings → Security**, then sign in with one tap. Notes:

- Registering your first passkey **disables password login** and mints **10 one-time recovery
  codes** (shown once — save them in your password manager). Toggle password login back on under
  Settings → Security if you ever need it.
- You can register multiple passkeys (e.g. a YubiKey that works on every machine **and** Touch ID
  on your Mac). Removing the last passkey re-enables password login automatically.
- Login fallbacks: **password** (if enabled) and **recovery code**.

**Break-glass (locked out — lost passkeys *and* recovery codes):** because you control the server,
run this on the host (Dokploy terminal or `docker exec`) to clear all passkeys + recovery codes and
re-enable password login:

```bash
npm run auth:reset
# optionally also set a new password in the same run:
RESET_PASSWORD='new-strong-password' npm run auth:reset
```

It needs `DATABASE_URL` (already in the container env). After running, sign in with your password
and re-register passkeys.

## APIs

Two HTTP surfaces, documented separately:

- **`/api/v1`** — scoped bearer-token CRUD over tasks, meetings, projects, milestones, and notes.
  Tokens are created under **Settings → API tokens**. See [`API.md`](API.md).
- **`POST /api/ingest`** — a static-bearer push endpoint for an external tool (e.g. a meeting
  recorder/transcriber) to deliver AI-generated notes, matched to a meeting by `calendar_event_id`
  or staged for review. See [`INGEST_API.md`](INGEST_API.md).

A running instance serves the docs **publicly** (no login): a rendered reference at **`/api-docs.html`**
and the machine-readable **OpenAPI 3.0** spec at **`/openapi.yaml`** — linked in-app from Settings →
API tokens and the Incoming notes screen. The spec ([`public/openapi.yaml`](public/openapi.yaml)) can
be imported into Postman/Insomnia, rendered with Swagger UI or Redoc (`npx @redocly/cli preview-docs
public/openapi.yaml`), or used to generate a client. The endpoints themselves stay token-gated — only
the docs are public.
