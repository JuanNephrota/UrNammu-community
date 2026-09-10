import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { getSetting } from "./settings";

// Sentinel model id meaning "always use the newest model the provider reports".
// Resolved at runtime via the Models API (see resolveLatestModel). This is the
// default when no model is pinned.
export const LATEST_MODEL_ID = "latest";

export const AI_PROVIDERS = {
  anthropic: {
    name: "Anthropic (Claude)",
    models: [
      { id: LATEST_MODEL_ID, name: "Latest (auto-updating)" },
      { id: "claude-opus-4-8", name: "Claude Opus 4.8" },
      { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5" },
    ],
    keyPlaceholder: "sk-ant-...",
  },
  openai: {
    name: "OpenAI (ChatGPT)",
    models: [
      { id: LATEST_MODEL_ID, name: "Latest (auto-updating)" },
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

// Pinned fallback used only when the Models API can't be reached. Keep current.
const LATEST_MODEL_FALLBACK: Record<AIProviderKey, string> = {
  anthropic: "claude-opus-4-8",
  openai: "gpt-4o",
};

// Models the Anthropic Models API lists but this org can't actually call
// (access-gated previews). "latest" resolution skips these so it doesn't pick a
// model that 404s. Update as the org's model access changes.
const LATEST_MODEL_DENYLIST = new Set<string>(["claude-fable-5"]);

type LatestCacheEntry = { model: string; expiresAt: number };
const latestModelCache: Partial<Record<AIProviderKey, LatestCacheEntry>> = {};
const LATEST_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolve the newest model a provider reports, so the app tracks new releases
 * without a code change. The Anthropic Models API lists models newest-first, so
 * `data[0]` is the latest. Cached for an hour; falls back to a pinned constant
 * if the API is unreachable. OpenAI's list isn't ordered by recency/capability,
 * so we use the fallback there rather than guess.
 */
async function resolveLatestModel(
  provider: AIProviderKey,
  apiKey: string
): Promise<string> {
  const cached = latestModelCache[provider];
  if (cached && cached.expiresAt > Date.now()) return cached.model;

  let model = LATEST_MODEL_FALLBACK[provider];
  if (provider === "anthropic" && apiKey) {
    try {
      const list = await new Anthropic({ apiKey }).models.list();
      // Models are returned newest-first; take the newest callable one.
      const newest = list.data?.find(
        (m) => m.id?.startsWith("claude-") && !LATEST_MODEL_DENYLIST.has(m.id)
      )?.id;
      if (newest) model = newest;
    } catch {
      // unreachable / no access — keep the pinned fallback
    }
  }
  latestModelCache[provider] = { model, expiresAt: Date.now() + LATEST_TTL_MS };
  return model;
}

// Models that accept `output_config.effort`. Allowlisted rather than
// denylisted so an unknown model just runs at the API default instead of
// erroring on an unsupported parameter (Haiku and pre-4.6 Sonnet reject it).
const EFFORT_MODELS =
  /^claude-(fable-5|mythos-5|opus-5|sonnet-5|opus-4-[5-9]|sonnet-4-6)/;

function supportsEffort(model: string): boolean {
  return EFFORT_MODELS.test(model);
}

/**
 * Get the configured AI provider, model, and API key.
 * Falls back to env vars if not configured in the database. When no model is
 * pinned (or the "latest" sentinel is selected), resolves the newest available
 * model via the Models API.
 */
export async function getAIConfig(): Promise<{
  provider: AIProviderKey;
  model: string;
  apiKey: string;
}> {
  const provider =
    ((await getSetting(AI_SETTINGS_KEYS.PROVIDER)) as AIProviderKey) ?? "anthropic";
  const apiKey =
    (await getSetting(AI_SETTINGS_KEYS.API_KEY)) ??
    (provider === "openai"
      ? process.env.OPENAI_API_KEY
      : process.env.ANTHROPIC_API_KEY) ??
    "";
  const configuredModel = await getSetting(AI_SETTINGS_KEYS.MODEL);
  const model =
    !configuredModel || configuredModel === LATEST_MODEL_ID
      ? await resolveLatestModel(provider, apiKey)
      : configuredModel;

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
    // Thinking is on by default on Claude Opus 5+, and max_tokens caps thinking
    // + response text together — a tight budget can spend the whole allowance
    // on thinking and return no text at all.
    max_tokens: 16000,
    ...(supportsEffort(model)
      ? { output_config: { effort: "medium" as const } }
      : {}),
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  // Responses may lead with thinking blocks, so collect every text block
  // rather than assuming content[0] is the answer.
  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!text) {
    throw new Error(
      response.stop_reason === "max_tokens"
        ? "Model hit the output token limit before producing a response."
        : `No text in model response (stop_reason: ${response.stop_reason ?? "unknown"}).`
    );
  }
  return text;
}
