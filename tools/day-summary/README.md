# Day Summary runner

A small local agent that writes Meeting Hub's **Day Summary** — one synthesis of
everything that happened across a single day's meetings. Every night it:

1. pulls one day's context from `GET /api/v1/day-summary-context` (each noted
   meeting's title, time, attendees, manual notes in full, and only the
   Summary / Decisions Made / Action Items sections of its AI-generated notes),
2. has Claude write the summary, via the **Claude Code CLI** — no Anthropic API
   key anywhere in this package,
3. pushes it back via `PUT /api/v1/day-summaries`.

Summaries appear at the top of that day's **Meetings** view. Generation happens
entirely here on your machine — the app has no LLM dependency and no scheduler,
the same arrangement as the weekly [Sunday Summary](../sunday-summary). Which
workspaces get summaries is this runner's config; a workspace not listed simply
never gets one.

A Day Summary is *not* a digest of per-meeting summaries — those already exist
in the app. It's for what only a whole-day view can see: a decision made in the
morning that gets validated in the afternoon, a date that shifts between
conversations, a commitment made once and never confirmed again.

## Setup

```sh
cd tools/day-summary
npm install
cp config.example.json config.json
```

Fill in `config.json`:

| Field | Meaning |
|---|---|
| `baseUrl` | Your Meeting Hub URL (prod, or `http://localhost:3000` to test) |
| `apiToken` | An `mh_` token with **write** scope — mint one under Settings → API tokens. Restrict it to the workspaces below. |
| `claudeBin` | Path to the Claude Code binary. Default `claude` (must be on `PATH`) — set an absolute path if launchd can't find it. |
| `model` | Model alias or full name. Default `opus`. |
| `effort` | Optional: `low`\|`medium`\|`high`\|`xhigh`\|`max`. Omit for Claude Code's default. |
| `maxCostUsd` | Optional spend ceiling per invocation, passed as `--max-budget-usd`. |
| `workspaces` | Workspace **names** to summarize (case-insensitive). This is the per-workspace enable/disable switch. |

`config.json` is gitignored — it holds secrets.

The only credential here is the Meeting Hub `mh_` token.

### How it talks to Claude

Generation shells out to the Claude Code CLI (`claude -p`), so it reuses the
login you already have — **there is no Anthropic API key in this package, and
no `ANTHROPIC_API_KEY` to export.** Usage bills the same way the rest of your
Claude Code usage does; each run prints its cost.

The invocation is deliberately locked down:

| Flag | Why |
|---|---|
| `--safe-mode` | Claude Code would otherwise load this repo's `CLAUDE.md`, skills, plugins, hooks, MCP servers and agents into the run. None of that belongs in a summarization prompt. Auth and model selection still work normally — unlike `--bare`, which refuses to read your existing login. |
| `--strict-mcp-config` | Belt and braces on the MCP half of the above. |
| `--tools ""` | No tools at all. This is pure text generation. |
| `--no-session-persistence` | Session transcripts are written to disk by default and would contain the day's note bodies verbatim. Real work content stays out of `~/.claude`. |
| `--permission-prompts none` | Nothing can block waiting for a human — this runs from launchd at 03:00. |
| `--output-format json` | Gives `stop_reason` / `is_error`, so a refusal or a truncated body is caught instead of being silently stored as the record. |

The prompt goes in on stdin rather than argv, since a full day of notes can be
larger than the argv limit, and the run happens in a temp directory.

## Run manually

```sh
npx tsx run.ts                     # yesterday
npx tsx run.ts --date 2026-09-14   # any past day — backfill
```

Runs are idempotent: the server upserts by `(workspace, day)`, so re-running
overwrites that day's summary. **A hand-edited summary is never overwritten** —
edits live in a separate field, and the app keeps rendering yours while offering
the regenerated original alongside.

Days with no notes on any meeting are skipped without calling the model, and
don't count as a failure — most weekends look like this.

## Which day, and which meetings

The runner picks the **day** (yesterday, by your laptop's clock) and nothing
else. Which meetings fall on that day is decided server-side by the same query
the day view uses, so a summary always covers exactly what that page shows. The
runner holds no copy of `APP_TIMEZONE`; times arrive pre-formatted.

## Staleness

The context response carries an `inputFingerprint` over the day's noted meetings
and their note timestamps. The runner echoes it back on push, and the server
stores it *as given* rather than recomputing — notes routinely land during the
minutes the model is writing, and the stored value has to describe the inputs
the summary was actually written from. The day view recomputes it on load and
flags **Inputs changed** when they differ. Nothing is ever silently rewritten;
re-run with `--date` if a summary should catch up.

## Schedule with launchd (nightly, 03:00)

```sh
cp com.meetinghub.day-summary.plist ~/Library/LaunchAgents/
# Edit the paths inside if your checkout isn't at ~/SynologyDrive/www/MeetingHub
launchctl load ~/Library/LaunchAgents/com.meetinghub.day-summary.plist
# Fire once now to test:
launchctl start com.meetinghub.day-summary
tail -f ~/Library/Logs/day-summary.log
```

03:00 rather than late evening: the day being summarized has genuinely ended,
and notes pushed by a recorder in the evening have landed.

launchd notes:

- If the Mac is **asleep** at 03:00, the job runs once on wake. As long as that
  happens before the next midnight it still resolves to the same day.
- If the Mac is **powered off** through the window, that firing is skipped —
  backfill with `npx tsx run.ts --date <day>`.
- launchd doesn't always inherit your interactive `PATH`. The plist runs
  `zsh -lc` so `~/.zprofile` is loaded, but if `claude` still isn't found, set
  `claudeBin` in `config.json` to its absolute path (`which claude`).

To unschedule: `launchctl unload ~/Library/LaunchAgents/com.meetinghub.day-summary.plist`.

## Notes

- The runner logs one line per workspace (sizes and statuses only) — never
  summary or context content.
- A refusal, an API error, or a body truncated at `max_tokens` fails the run
  loudly rather than pushing a half-finished entry — a day summary becomes the
  permanent record of that day.
- The prompt's guardrails in `prompt.ts` exist because AI-generated notes are
  transcript reconstructions that mangle proper nouns. A day summary becomes
  the record, so the prompt forbids introducing any name, date or figure that
  isn't in the manual notes unless the generated notes agree consistently.
  Edit with care.
- This directory is excluded from the app's Docker build and root typecheck
  (`.dockerignore`, root `tsconfig.json`); it has its own `npm run typecheck`.
