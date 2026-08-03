// Sunday Summary runner: for each enabled workspace, pull the week's context
// from Meeting Hub, have Claude write the briefing, push it back. Scheduled by
// launchd (see com.meetinghub.sunday-summary.plist); safe to re-run — the
// server upserts by (workspace, weekStart).
//
// Logging rule: one line per workspace with sizes and statuses only. Never log
// prompt or summary content — it's real work data.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { getSummaryContext, getWorkspaces, putSummary } from "./api.js";
import { targetWeekStart } from "./lib.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";

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
  context: unknown,
): Promise<string> {
  // Server-side refusal fallback: if the model's safety classifiers decline
  // (rare, but possible on benign content), the API retries on Anthropic's
  // recommended fallback model in the same call. `fallbacks` isn't in the
  // SDK's typings yet (0.70.x) — unknown keys are forwarded on the wire.
  const params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(context) }],
    betas: ["server-side-fallback-2026-07-01"],
  };
  const res = await client.beta.messages.create({
    ...params,
    fallbacks: "default",
  } as typeof params);
  if (res.stop_reason === "refusal") {
    throw new Error("model declined to generate (refusal, all fallbacks)");
  }
  if (res.stop_reason === "max_tokens") {
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
  const maxTokens = cfg.maxOutputTokens ?? 8000;
  const weekStart = targetWeekStart();
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
        `[sunday-summary] workspace "${name}" not found on the server ` +
          `(token can see: ${available.map((w) => w.name).join(", ")}) — skipping`,
      );
      failures += 1;
      continue;
    }
    try {
      const context = await getSummaryContext(cfg, ws.id, weekStart);
      const markdown = await generateSummary(client, model, maxTokens, context);
      const { created } = await putSummary(cfg, ws.id, {
        weekStart,
        markdown,
        model,
        generatedAt: new Date().toISOString(),
      });
      console.log(
        `[sunday-summary] ${ws.name}: week ${weekStart}, ` +
          `${markdown.length} chars pushed (${created ? "created" : "updated"})`,
      );
    } catch (e) {
      failures += 1;
      console.error(
        `[sunday-summary] ${ws.name}: FAILED — ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  if (failures > 0) {
    console.error(`[sunday-summary] ${failures} workspace(s) failed`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`[sunday-summary] fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
