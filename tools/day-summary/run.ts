// Day Summary runner: for each enabled workspace, pull one day's meeting-note
// context from Meeting Hub, have Claude write the summary, push it back.
// Scheduled by launchd (see com.meetinghub.day-summary.plist); safe to re-run —
// the server upserts by (workspace, day).
//
// Logging rule: one line per workspace with sizes and statuses only. Never log
// prompt or summary content — it's real work data.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
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
  anthropicApiKey?: string;
  model?: string;
  maxOutputTokens?: number;
  workspaces: string[];
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
  if (!cfg.anthropicApiKey && !process.env.ANTHROPIC_API_KEY) {
    throw new Error("config: set anthropicApiKey or the ANTHROPIC_API_KEY env var");
  }
  return cfg;
}

async function generateSummary(
  client: Anthropic,
  model: string,
  maxTokens: number,
  context: DaySummaryContext,
): Promise<string> {
  // Streamed: a synthesis over a full day of notes with adaptive thinking on
  // can outrun the SDK's HTTP timeout at this max_tokens.
  //
  // Server-side refusal fallback: if the model's safety classifiers decline
  // (rare, but possible on benign content), the API retries on Anthropic's
  // recommended fallback model in the same call. `fallbacks` isn't in the
  // SDK's typings yet — unknown keys are forwarded on the wire.
  const params: Anthropic.Beta.Messages.MessageCreateParamsStreaming = {
    model,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    system: DAY_SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(context) }],
    betas: ["server-side-fallback-2026-07-01"],
    stream: true,
  };
  const stream = client.beta.messages.stream({
    ...params,
    fallbacks: "default",
  } as typeof params);
  const res = await stream.finalMessage();

  if (res.stop_reason === "refusal") {
    throw new Error("model declined to generate (refusal, all fallbacks)");
  }
  if (res.stop_reason === "max_tokens") {
    // Fail loudly rather than push a half-finished journal entry — it becomes
    // the permanent record of that day.
    throw new Error("summary truncated at max_tokens — raise maxOutputTokens");
  }
  const markdown = res.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (!markdown) throw new Error("model returned no text");
  return markdown;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const model = cfg.model ?? "claude-opus-5";
  const maxTokens = cfg.maxOutputTokens ?? 16000;
  const day = parseArgs(process.argv.slice(2)).date ?? targetDay();
  const client = new Anthropic({
    apiKey: cfg.anthropicApiKey || process.env.ANTHROPIC_API_KEY,
  });

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
      const markdown = await generateSummary(client, model, maxTokens, context);
      const { created } = await putDaySummary(cfg, ws.id, {
        date: day,
        markdown,
        model,
        generatedAt: new Date().toISOString(),
        inputFingerprint: context.inputFingerprint,
      });
      console.log(
        `[day-summary] ${ws.name}: ${day}, ${context.meetingCount} meeting(s), ` +
          `${markdown.length} chars pushed (${created ? "created" : "updated"})`,
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
