// Day Summary runner: for each enabled workspace, pull one day's meeting-note
// context from Meeting Hub, have Claude write the summary, push it back.
// Scheduled by launchd (see com.meetinghub.day-summary.plist); safe to re-run —
// the server upserts by (workspace, day).
//
// Logging rule: one line per workspace with sizes and statuses only. Never log
// prompt or summary content — it's real work data.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getDaySummaryContext,
  getWorkspaces,
  putDaySummary,
  type DaySummaryContext,
} from "./api.js";
import { parseArgs, targetDay } from "./lib.js";
import { DAY_SUMMARY_SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

type Config = {
  baseUrl: string;
  apiToken: string;
  /** Path to the Claude Code binary. Default "claude" (must be on PATH). */
  claudeBin?: string;
  /** Model alias or full name, e.g. "opus" or "claude-opus-5". */
  model?: string;
  /** low | medium | high | xhigh | max. Omit for Claude Code's default. */
  effort?: string;
  /** Optional spend ceiling per invocation, in USD. */
  maxCostUsd?: number;
  workspaces: string[];
};

// What `claude -p --output-format json` prints. Only the fields used here.
type ClaudeResult = {
  result?: string;
  is_error?: boolean;
  subtype?: string;
  stop_reason?: string;
  api_error_status?: string | null;
  total_cost_usd?: number;
};

const here = dirname(fileURLToPath(import.meta.url));

function loadConfig(): Config {
  let raw: string;
  try {
    raw = readFileSync(join(here, "config.json"), "utf8");
  } catch {
    throw new Error(
      "config.json not found — copy config.example.json and fill it in",
    );
  }
  const cfg = JSON.parse(raw) as Config;
  if (!cfg.baseUrl) throw new Error("config: baseUrl is required");
  if (!cfg.apiToken?.startsWith("mh_")) {
    throw new Error("config: apiToken must be a Meeting Hub mh_ token (write scope)");
  }
  if (!Array.isArray(cfg.workspaces) || cfg.workspaces.length === 0) {
    throw new Error("config: workspaces must list at least one workspace name");
  }
  // No Anthropic credentials needed here: generation shells out to the Claude
  // Code CLI, which uses whatever login you already have (`claude auth`).
  return cfg;
}

/**
 * Run the prompt through the Claude Code CLI and return the markdown.
 *
 * Shelling out to `claude` rather than calling the API directly means no
 * Anthropic API key exists anywhere in this package — it reuses the login you
 * already have. The flags below matter:
 *
 *  --safe-mode              Claude Code would otherwise load this repo's
 *                           CLAUDE.md, skills, plugins, hooks, MCP servers and
 *                           custom agents into the run. None of that belongs in
 *                           a summarization prompt. Auth and model selection
 *                           still work normally (unlike --bare, which refuses
 *                           to read your existing login).
 *  --strict-mcp-config      Belt and braces on the MCP half of the above.
 *  --tools ""               No tools at all. This is pure text generation; a
 *                           tool call here would be a bug, not a feature.
 *  --no-session-persistence Session transcripts are written to disk by default
 *                           and would contain the day's note bodies verbatim.
 *                           Real work content doesn't get left in ~/.claude.
 *  --permission-prompts none Nothing can block waiting for a human — this runs
 *                           from launchd at 03:00.
 *  --output-format json     Gives stop_reason / is_error / subtype, so a
 *                           refusal or a truncated body is detectable instead
 *                           of being silently stored as the record.
 *
 * The prompt goes in on stdin, not argv: a full day of notes can be large, and
 * argv has a hard size limit.
 */
async function generateSummary(
  cfg: Config,
  context: DaySummaryContext,
): Promise<{ markdown: string; model: string; costUsd?: number }> {
  const bin = cfg.claudeBin ?? "claude";
  const model = cfg.model ?? "opus";
  const args = [
    "--print",
    "--system-prompt",
    DAY_SUMMARY_SYSTEM_PROMPT,
    "--model",
    model,
    "--output-format",
    "json",
    "--tools",
    "",
    "--safe-mode",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--permission-prompts",
    "none",
  ];
  if (cfg.effort) args.push("--effort", cfg.effort);
  if (cfg.maxCostUsd !== undefined) {
    args.push("--max-budget-usd", String(cfg.maxCostUsd));
  }

  const { stdout, stderr, code } = await run(bin, args, buildUserPrompt(context));

  if (code !== 0) {
    // stderr can carry a prompt echo on some failures, so only the tail is
    // surfaced and it is never logged wholesale.
    const hint = stderr.trim().split("\n").slice(-2).join(" ").slice(0, 300);
    throw new Error(`claude exited ${code}${hint ? `: ${hint}` : ""}`);
  }

  let parsed: ClaudeResult;
  try {
    parsed = JSON.parse(stdout) as ClaudeResult;
  } catch {
    throw new Error("claude did not return JSON (is --output-format supported?)");
  }
  if (parsed.is_error || (parsed.subtype && parsed.subtype !== "success")) {
    throw new Error(
      `claude reported an error (${parsed.subtype ?? "unknown"}${
        parsed.api_error_status ? `, api ${parsed.api_error_status}` : ""
      })`,
    );
  }
  if (parsed.stop_reason === "refusal") {
    throw new Error("model declined to generate (refusal)");
  }
  if (parsed.stop_reason === "max_tokens") {
    // Fail loudly rather than push a half-finished journal entry — it becomes
    // the permanent record of that day.
    throw new Error("summary truncated at max_tokens");
  }
  const markdown = (parsed.result ?? "").trim();
  if (!markdown) throw new Error("claude returned no text");
  return { markdown, model, costUsd: parsed.total_cost_usd };
}

/** Spawn a command, feed it stdin, collect stdout/stderr. */
function run(
  bin: string,
  args: string[],
  stdin: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    // cwd is a neutral directory: --safe-mode already stops CLAUDE.md
    // discovery, but there is no reason for the run to sit inside the repo.
    const child = spawn(bin, args, { cwd: tmpdir() });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (e: NodeJS.ErrnoException) => {
      reject(
        e.code === "ENOENT"
          ? new Error(
              `Claude Code CLI not found at "${bin}". Install it, or set ` +
                `"claudeBin" in config.json to its absolute path ` +
                `(launchd does not always inherit your PATH).`,
            )
          : e,
      );
    });
    child.on("close", (code: number | null) =>
      resolve({ stdout, stderr, code: code ?? 1 }),
    );
    child.stdin.end(stdin);
  });
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const day = parseArgs(process.argv.slice(2)).date ?? targetDay();

  const available = await getWorkspaces(cfg);
  const byName = new Map(available.map((w) => [w.name.toLowerCase(), w]));

  let failures = 0;
  for (const name of cfg.workspaces) {
    const ws = byName.get(name.toLowerCase());
    if (!ws) {
      console.error(
        `[day-summary] workspace "${name}" not found on the server ` +
          `(token can see: ${available.map((w) => w.name).join(", ")}) — skipping`,
      );
      failures += 1;
      continue;
    }
    if (ws.disabledFeatures.includes("meetings")) {
      // Not a failure: the workspace is configured to have no meetings at all.
      console.log(`[day-summary] ${ws.name}: skipped (meetings feature off)`);
      continue;
    }
    try {
      const context = await getDaySummaryContext(cfg, ws.id, day);
      if (!context.hasNotes) {
        // The common case on weekends and quiet days. Never call the model,
        // and never count it as a failure — a nightly job that "fails" every
        // Saturday is a job whose log nobody reads.
        console.log(`[day-summary] ${ws.name}: ${day} skipped (no notes)`);
        continue;
      }
      const { markdown, model, costUsd } = await generateSummary(cfg, context);
      const { created } = await putDaySummary(cfg, ws.id, {
        date: day,
        markdown,
        model,
        generatedAt: new Date().toISOString(),
        inputFingerprint: context.inputFingerprint,
      });
      console.log(
        `[day-summary] ${ws.name}: ${day}, ${context.meetingCount} meeting(s), ` +
          `${markdown.length} chars pushed (${created ? "created" : "updated"})` +
          (costUsd !== undefined ? `, $${costUsd.toFixed(3)}` : ""),
      );
    } catch (e) {
      failures += 1;
      console.error(
        `[day-summary] ${ws.name}: FAILED — ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  if (failures > 0) {
    console.error(`[day-summary] ${failures} workspace(s) failed`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`[day-summary] fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
