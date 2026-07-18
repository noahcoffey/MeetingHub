# Contributing to Meeting Hub

Thanks for your interest in improving Meeting Hub! This is a self-hosted, single-user
web app for meeting notes and action items. Contributions of all sizes are welcome —
bug reports, docs, and code.

## Ways to contribute

- **Report a bug** — open a [GitHub issue](https://github.com/noahcoffey/MeetingHub/issues)
  with steps to reproduce, expected vs. actual behavior, and your environment.
- **Report a security vulnerability** — **do not open a public issue.** Follow the process
  in [`SECURITY.md`](./SECURITY.md) (GitHub's private vulnerability reporting).
- **Suggest a feature** — open an issue to discuss it before you invest time in a PR.
- **Submit a fix or improvement** — see the workflow below.

## Development setup

**Prerequisites:** Node.js 20+, Docker (for local Postgres), and `git`.

```bash
# 1. Fork & clone
git clone https://github.com/<you>/MeetingHub.git
cd MeetingHub

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env.local     # then edit values as needed

# 4. Start local Postgres
docker compose -f docker-compose.dev.yml up -d

# 5. Apply migrations and seed the single user
npm run db:migrate
npm run db:seed

# 6. Run the dev server (http://localhost:3000)
npm run dev
```

See [`README.md`](./README.md) for full setup and deployment details.

## Before you open a pull request

Run all of these locally — the CI gates the PR on the first three:

```bash
npm run typecheck     # TypeScript (strict)
npm run lint          # ESLint
npm test              # Vitest integration/unit tests (needs local Postgres up)
npm run test:e2e      # Playwright E2E (needs: npx playwright install chromium — once)
```

If you change `src/db/schema.ts`, regenerate migrations with `npm run db:generate` and
commit the generated files under `drizzle/`. **Never** hand-edit generated migration SQL.

### Conventions

- **TypeScript strict** — no `any` without a justifying comment.
- Keep components small; colocate route handlers under `src/app/api/`.
- **Never log** note bodies, action-item content, or attendee data — that's real work content.
- All secrets live in env (`.env.local` for dev). Never commit secrets.
- Match the style of the surrounding code (naming, comment density, idiom).
- Add or update tests for the behavior you change.

## Pull request process

1. Create a branch off `main` (e.g. `fix/calendar-timezone`, `feat/journal-export`).
2. Make focused commits with clear messages.
3. Open a PR against `main` with a description of **what** changed and **why**.
4. CI must pass: **typecheck · lint · build**, **unit tests (Vitest)**, **e2e (Playwright)**.
5. Resolve any review conversations. PRs require **one maintainer approval** before merge.
6. Keep the PR up to date with `main` if asked; squash-friendly, focused history is preferred.

## Code of conduct

Be respectful and constructive. Assume good faith, keep discussion technical, and help keep
this a welcoming project for everyone.

## License

By contributing, you agree that your contributions are licensed under the project's
[MIT License](./LICENSE).
