import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getSetting } from "./settings";

export const AI_PROVIDERS = {
  anthropic: {
    name: "Anthropic (Claude)",
    models: [
      { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
      { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
      { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
    ],
    keyPlaceholder: "sk-ant-...",
  },
  openai: {
    name: "OpenAI (ChatGPT)",
    models: [
      { id: "gpt-4o", name: "GPT-4o" },
      { id: "gpt-4o-mini", name: "GPT-4o Mini" },
      { id: "o1", name: "o1" },
      { id: "o1-mini", name: "o1 Mini" },
    ],
    keyPlaceholder: "sk-...",
  },
} as const;

export type AIProviderKey = keyof typeof AI_PROVIDERS;

export const AI_SETTINGS_KEYS = {
  PROVIDER: "ai_provider",
  API_KEY: "ai_api_key",
  MODEL: "ai_model",
} as const;

/**
 * Get the configured AI provider, model, and API key.
 * Falls back to env vars if not configured in the database.
 */
async function getAIConfig(): Promise<{
  provider: AIProviderKey;
  model: string;
  apiKey: string;
}> {
  const provider =
    ((await getSetting(AI_SETTINGS_KEYS.PROVIDER)) as AIProviderKey) ?? "anthropic";
  const model =
    (await getSetting(AI_SETTINGS_KEYS.MODEL)) ??
    (provider === "openai" ? "gpt-4o" : "claude-sonnet-4-20250514");
  const apiKey =
    (await getSetting(AI_SETTINGS_KEYS.API_KEY)) ??
    (provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY) ??
    "";

  return { provider, model, apiKey };
}

/**
 * Send a prompt to the configured AI provider and return the text response.
 */
export async function generateAIResponse(
  systemPrompt: string,
  userPrompt: string
): Promise<string> {
  const { provider, model, apiKey } = await getAIConfig();

  if (!apiKey) {
    throw new Error(
      `No API key configured for ${AI_PROVIDERS[provider]?.name ?? provider}. Configure it in Settings > General.`
    );
  }

  if (provider === "openai") {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      max_tokens: 2048,
    });
    return response.choices[0]?.message?.content ?? "";
  }

  // Default: Anthropic
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const content = response.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");
  return content.text;
}
