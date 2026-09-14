import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { DAY_SUMMARY_SYSTEM_PROMPT } from "./day-summary-prompt";

// The one place this app talks to an LLM. Generation used to be strictly
// out-of-app (see the Sunday-Summary runner in tools/); the Day Summary is the
// deliberate exception — it is triggered by a button on the day view, so it has
// to run server-side here. Keep the dependency contained to this module.

export class DaySummaryNotConfiguredError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not set");
    this.name = "DaySummaryNotConfiguredError";
  }
}

export const DAY_SUMMARY_MODEL =
  process.env.DAY_SUMMARY_MODEL ?? "claude-opus-5";

export function isDaySummaryConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export type DaySummaryGenerator = (
  prompt: string,
) => Promise<{ markdown: string; model: string }>;

/**
 * Default generator: one Messages call, streamed.
 *
 * Streaming (rather than a plain create) because a synthesis over a full day of
 * notes with adaptive thinking on can run well past the SDK's HTTP timeout at
 * this `max_tokens`. `.finalMessage()` gives back the completed message, so the
 * caller never sees stream events.
 *
 * Never log the prompt or the response — both are real work content (see the
 * "never log note bodies" rule in CLAUDE.md).
 */
export const generateWithClaude: DaySummaryGenerator = async (prompt) => {
  if (!isDaySummaryConfigured()) throw new DaySummaryNotConfiguredError();
  const client = new Anthropic();
  const stream = client.messages.stream({
    model: DAY_SUMMARY_MODEL,
    // Generous: adaptive thinking spends from the same budget, and a summary
    // truncated mid-sentence would be stored as the permanent record.
    max_tokens: 32000,
    thinking: { type: "adaptive" },
    system: DAY_SUMMARY_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
  });
  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error("The model declined to write this summary.");
  }
  if (message.stop_reason === "max_tokens") {
    // Fail loudly rather than persist a half-finished journal entry.
    throw new Error("The summary was cut off before it finished.");
  }
  const markdown = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  if (markdown === "") throw new Error("The model returned an empty summary.");
  return { markdown, model: message.model };
};
