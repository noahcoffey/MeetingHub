# Sunday Summary runner

A small local agent that prepares a weekly "Sunday Summary" for Meeting Hub.
Every Sunday morning it:

1. pulls each enabled workspace's week context from `GET /api/v1/summary-context`
   (upcoming meetings, tasks due/overdue, milestones, last week's completed work
   and journal reflections, stale waiting-on items, agenda queues, trends),
2. has Claude write a markdown briefing for the week ahead,
3. pushes it back via `PUT /api/v1/summaries`.

Summaries appear in the app under **Summaries**. Generation happens entirely
here on your machine — the app has no LLM dependency and no scheduler. Which
workspaces get a summary is this runner's config; a workspace not listed simply
never gets one.

## Setup

```sh
cd tools/sunday-summary
npm install
cp config.example.json config.json
```

Fill in `config.json`:

| Field | Meaning |
|---|---|
| `baseUrl` | Your Meeting Hub URL (prod, or `http://localhost:3000` to test) |
| `apiToken` | An `mh_` token with **write** scope — mint one under Settings → API tokens. Restrict it to the workspaces below. |
| `anthropicApiKey` | Anthropic API key; leave `""` to use the `ANTHROPIC_API_KEY` env var |
| `model` | Default `claude-opus-5` |
| `maxOutputTokens` | Default `8000` |
| `workspaces` | Workspace **names** to summarize (case-insensitive). This is the per-workspace enable/disable switch. |

`config.json` is gitignored — it holds secrets.

## Run manually

```sh
npx tsx run.ts
```

Runs are idempotent: the server upserts by `(workspace, weekStart)`, so
re-running overwrites that week's summary. The target week is the Monday of
*tomorrow*'s week — a Sunday run preps the coming week, and a Monday catch-up
run lands on the same summary.

## Schedule with launchd (Sundays 7:00)

```sh
cp com.meetinghub.sunday-summary.plist ~/Library/LaunchAgents/
# Edit the paths inside if your checkout isn't at ~/SynologyDrive/www/MeetingHub
launchctl load ~/Library/LaunchAgents/com.meetinghub.sunday-summary.plist
# Fire once now to test:
launchctl start com.meetinghub.sunday-summary
tail -f ~/Library/Logs/sunday-summary.log
```

launchd notes:

- If the Mac is **asleep** at 7:00 Sunday, the job runs once on wake — good for
  a laptop.
- If the Mac is **powered off**, that firing is skipped; run `npx tsx run.ts`
  manually (idempotent).
- If `config.json` uses the env-var fallback for the Anthropic key, remember
  launchd doesn't read your shell profile for env vars — the plist runs
  `zsh -lc`, which loads `~/.zprofile`, so export it there (or put the key in
  `config.json`).

To unschedule: `launchctl unload ~/Library/LaunchAgents/com.meetinghub.sunday-summary.plist`.

## Notes

- The runner logs one line per workspace (sizes and statuses only) — never
  summary or context content.
- A refusal from the model's safety classifiers is automatically retried on
  Anthropic's recommended fallback model (server-side `fallbacks: "default"`).
- This directory is excluded from the app's Docker build and root typecheck
  (`.dockerignore`, root `tsconfig.json`); it has its own
  `npm run typecheck`.
