/**
 * Model pricing and token accounting shared by every proxy path.
 *
 * MIRRORED FILE — `src/lib/model-pricing.ts` and `ai-proxy/src/lib/pricing.ts`
 * must stay byte-identical. The Azure Functions project cannot import from the
 * Next.js app, so the file is copied by hand; CI does not enforce it yet.
 *
 * Token accounting convention (matches `src/lib/provider-telemetry.ts`, the
 * Anthropic admin-sync writer, so proxy_live rows and admin-sync rows in
 * `UsageBucket` add up the same way):
 *
 *   - Anthropic reports `input_tokens` EXCLUDING cached tokens. Total prompt
 *     size = input_tokens + cache_read_input_tokens + cache_creation_input_tokens.
 *   - OpenAI reports `prompt_tokens` INCLUDING cached tokens;
 *     `prompt_tokens_details.cached_tokens` is the cached subset.
 *
 *   We normalise both into a `TokenUsage` of four disjoint buckets
 *   (uncachedInputTokens, cacheReadTokens, cacheCreationTokens, outputTokens)
 *   and then persist:
 *
 *     promptTokens / UsageBucket.inputTokens = uncached + cacheRead + cacheCreation
 *         (ALL input tokens — the number the provider actually processed)
 *     UsageBucket.cacheReadTokens / cacheCreationTokens = the cached breakdown
 *     completionTokens / outputTokens = output tokens
 *     totalTokens = promptTokens + completionTokens
 *
 *   `APIUsageLog` has no cache columns; the breakdown goes into its
 *   `promptMetadata` JSON as `cacheReadTokens`, `cacheCreationTokens` and
 *   `uncachedInputTokens`, alongside `pricingMatched`.
 *
 * Cost = uncached×input + cacheRead×cacheRead + cacheCreation×cacheWrite +
 *        output×output (all prices per million tokens). Unknown models cost
 * `null` and report `pricingMatched: false` — we never silently bill a default.
 */

export type PricingProvider = "anthropic" | "openai";

/** Legacy provider names used by `APIUsageLog.provider` are accepted too. */
export type PricingProviderInput = PricingProvider | "claude" | "chatgpt";

/** USD per million tokens. */
export type ModelPrice = {
  input: number;
  output: number;
  /** Prompt-cache hit (Anthropic `cache_read_input_tokens`, OpenAI `cached_tokens`). */
  cacheRead: number;
  /**
   * Prompt-cache write (Anthropic `cache_creation_input_tokens`). Priced at the
   * 5-minute-TTL rate (1.25× input); 1-hour writes are 2× but the streaming
   * usage payload does not split them out, so we under-count those slightly.
   * OpenAI has no write premium — set equal to `input` and never charged
   * because OpenAI reports no cache-creation tokens.
   */
  cacheWrite: number;
};

/** Four disjoint token buckets — see the module comment for the convention. */
export type TokenUsage = {
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
};

export type CostResult = {
  /** USD, or `null` when the model has no pricing entry. */
  cost: number | null;
  pricingMatched: boolean;
  /** Pricing-table key that matched (exact id or family prefix). */
  matchedModel: string | null;
};

/** What the proxies persist for one request. */
export type AccountedUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
};

const anthropic = (
  input: number,
  output: number,
  cacheRead = input * 0.1
): ModelPrice => ({ input, output, cacheRead, cacheWrite: input * 1.25 });

const openai = (input: number, output: number, cacheRead = input * 0.5): ModelPrice => ({
  input,
  output,
  cacheRead,
  cacheWrite: input,
});

/**
 * Anthropic first-party API rates. Keys are bare model ids; dated snapshots
 * resolve to their family via longest-prefix matching (e.g.
 * `claude-sonnet-5-20260101` → `claude-sonnet-5`) unless listed explicitly.
 */
const ANTHROPIC_PRICING: Record<string, ModelPrice> = {
  // Current generation
  "claude-fable-5-1": anthropic(10.0, 50.0, 0.25),
  "claude-fable-5": anthropic(10.0, 50.0),
  "claude-opus-5": anthropic(5.0, 25.0),
  "claude-sonnet-5": anthropic(2.0, 10.0),
  "claude-haiku-4-5": anthropic(1.0, 5.0),
  // 4.x family still served
  "claude-opus-4-8": anthropic(5.0, 25.0),
  "claude-opus-4-7": anthropic(5.0, 25.0),
  "claude-opus-4-6": anthropic(5.0, 25.0),
  "claude-opus-4-5": anthropic(5.0, 25.0),
  "claude-sonnet-4-6": anthropic(3.0, 15.0),
  "claude-sonnet-4-5": anthropic(3.0, 15.0),
  // Deprecated / legacy ids — kept so in-flight traffic still prices.
  "claude-opus-4-1": anthropic(15.0, 75.0),
  "claude-opus-4-0": anthropic(15.0, 75.0),
  "claude-opus-4-20250514": anthropic(15.0, 75.0),
  "claude-sonnet-4-0": anthropic(3.0, 15.0),
  "claude-sonnet-4-20250514": anthropic(3.0, 15.0),
  "claude-haiku-4-5-20251001": anthropic(1.0, 5.0),
  "claude-3-7-sonnet": anthropic(3.0, 15.0),
  "claude-3-5-sonnet": anthropic(3.0, 15.0),
  "claude-3-5-haiku": anthropic(0.8, 4.0),
  "claude-3-opus": anthropic(15.0, 75.0),
  "claude-3-haiku": anthropic(0.25, 1.25),
};

/**
 * OpenAI list prices. Models without a published cached-input discount
 * (gpt-4-turbo, gpt-4, gpt-3.5-turbo) charge cache reads at the input rate.
 */
const OPENAI_PRICING: Record<string, ModelPrice> = {
  "gpt-5": openai(1.25, 10.0, 0.125),
  "gpt-5-mini": openai(0.25, 2.0, 0.025),
  "gpt-5-nano": openai(0.05, 0.4, 0.005),
  "gpt-4.1": openai(2.0, 8.0, 0.5),
  "gpt-4.1-mini": openai(0.4, 1.6, 0.1),
  "gpt-4.1-nano": openai(0.1, 0.4, 0.025),
  "gpt-4o": openai(2.5, 10.0, 1.25),
  "gpt-4o-mini": openai(0.15, 0.6, 0.075),
  "gpt-4-turbo": openai(10.0, 30.0, 10.0),
  "gpt-4": openai(30.0, 60.0, 30.0),
  "gpt-3.5-turbo": openai(0.5, 1.5, 0.5),
  o1: openai(15.0, 60.0, 7.5),
  "o1-mini": openai(3.0, 12.0, 1.5),
  o3: openai(2.0, 8.0, 0.5),
  "o4-mini": openai(1.1, 4.4, 0.275),
};

export function normalizePricingProvider(provider: PricingProviderInput): PricingProvider {
  return provider === "claude" || provider === "anthropic" ? "anthropic" : "openai";
}

/**
 * Canonicalise a model id before lookup: lower-case, strip a Bedrock-style
 * `anthropic.` / `us.anthropic.` prefix and a Vertex-style `@version` suffix.
 */
export function normalizeModelId(model: string): string {
  const lowered = model
    .trim()
    .toLowerCase()
    .replace(/^(?:[a-z]{2,3}\.)?anthropic\./, "");
  // Drop a Vertex-style `@version` suffix. Plain indexOf rather than a regex:
  // the id comes from client input and `/@.*$/` is flagged as polynomial
  // backtracking by CodeQL.
  const at = lowered.indexOf("@");
  return at === -1 ? lowered : lowered.slice(0, at);
}

/**
 * Exact id first, then the LONGEST table key that is a family prefix of the
 * model id at a `-` boundary (`gpt-4o-mini-2024-07-18` → `gpt-4o-mini`, not
 * `gpt-4o`; `gpt-4o` never matches `gpt-4`). Never `includes()`.
 */
export function resolveModelPrice(
  provider: PricingProviderInput,
  model: string
): { key: string; price: ModelPrice } | null {
  const table =
    normalizePricingProvider(provider) === "anthropic" ? ANTHROPIC_PRICING : OPENAI_PRICING;
  const id = normalizeModelId(model);
  if (!id) return null;

  const exact = table[id];
  if (exact) return { key: id, price: exact };

  let best: { key: string; price: ModelPrice } | null = null;
  for (const [key, price] of Object.entries(table)) {
    if (id.length <= key.length) continue;
    if (!id.startsWith(key) || id[key.length] !== "-") continue;
    if (!best || key.length > best.key.length) best = { key, price };
  }
  return best;
}

export function calculateCost(
  provider: PricingProviderInput,
  model: string,
  usage: TokenUsage
): CostResult {
  const match = resolveModelPrice(provider, model);
  if (!match) return { cost: null, pricingMatched: false, matchedModel: null };
  const p = match.price;
  const cost =
    (usage.uncachedInputTokens * p.input +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheCreationTokens * p.cacheWrite +
      usage.outputTokens * p.output) /
    1_000_000;
  return { cost, pricingMatched: true, matchedModel: match.key };
}

// ── Usage normalisation ──────────────────────────────────────────────────────

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

export type AnthropicUsagePayload = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export type OpenAIUsagePayload = {
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  prompt_tokens_details?: { cached_tokens?: number | null } | null;
};

export const EMPTY_USAGE: TokenUsage = {
  uncachedInputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  outputTokens: 0,
};

/** Non-streaming Anthropic `usage` → TokenUsage. `input_tokens` is already uncached. */
export function usageFromAnthropic(usage: AnthropicUsagePayload | null | undefined): TokenUsage {
  return {
    uncachedInputTokens: num(usage?.input_tokens),
    cacheReadTokens: num(usage?.cache_read_input_tokens),
    cacheCreationTokens: num(usage?.cache_creation_input_tokens),
    outputTokens: num(usage?.output_tokens),
  };
}

/** Non-streaming OpenAI `usage` → TokenUsage. `prompt_tokens` includes cached tokens. */
export function usageFromOpenAI(usage: OpenAIUsagePayload | null | undefined): TokenUsage {
  const prompt = num(usage?.prompt_tokens);
  const cached = Math.min(prompt, num(usage?.prompt_tokens_details?.cached_tokens));
  return {
    uncachedInputTokens: prompt - cached,
    cacheReadTokens: cached,
    cacheCreationTokens: 0,
    outputTokens: num(usage?.completion_tokens),
  };
}

/**
 * Fold one Anthropic SSE event into a running TokenUsage.
 *
 * `message_start` carries the full input breakdown (input, cache_read,
 * cache_creation) plus a provisional `output_tokens`; `message_delta` carries
 * the final `output_tokens` and, on current API versions, cumulative input
 * fields as well. Each numeric field present on a later event overrides the
 * earlier value — these are cumulative counts, not increments.
 */
export function mergeAnthropicStreamUsage(current: TokenUsage, event: unknown): TokenUsage {
  if (!event || typeof event !== "object") return current;
  const e = event as {
    type?: string;
    message?: { usage?: AnthropicUsagePayload | null } | null;
    usage?: AnthropicUsagePayload | null;
  };
  const usage =
    e.type === "message_start" ? e.message?.usage : e.type === "message_delta" ? e.usage : null;
  if (!usage || typeof usage !== "object") return current;

  const pick = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : fallback;

  return {
    uncachedInputTokens: pick(usage.input_tokens, current.uncachedInputTokens),
    cacheReadTokens: pick(usage.cache_read_input_tokens, current.cacheReadTokens),
    cacheCreationTokens: pick(usage.cache_creation_input_tokens, current.cacheCreationTokens),
    outputTokens: pick(usage.output_tokens, current.outputTokens),
  };
}

/**
 * Fold one OpenAI chat-completions SSE chunk into a running TokenUsage.
 * Only the final chunk (emitted with `stream_options.include_usage`) carries
 * a non-null `usage`; every other chunk has `usage: null` or no field.
 */
export function mergeOpenAIStreamUsage(current: TokenUsage, chunk: unknown): TokenUsage {
  if (!chunk || typeof chunk !== "object") return current;
  const usage = (chunk as { usage?: OpenAIUsagePayload | null }).usage;
  if (!usage || typeof usage !== "object") return current;
  return usageFromOpenAI(usage);
}

/**
 * True for the trailing usage-only chunk OpenAI emits when
 * `stream_options.include_usage` is set: `choices` is empty and `usage` is
 * present. The Vercel proxy strips this chunk when it injected the option on
 * the client's behalf.
 */
export function isOpenAIUsageOnlyChunk(chunk: unknown): boolean {
  if (!chunk || typeof chunk !== "object") return false;
  const c = chunk as { choices?: unknown; usage?: unknown };
  const noChoices = !Array.isArray(c.choices) || c.choices.length === 0;
  return noChoices && !!c.usage && typeof c.usage === "object";
}

export function totalInputTokens(usage: TokenUsage): number {
  return usage.uncachedInputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
}

/** Apply the persistence convention from the module comment. */
export function accountTokens(usage: TokenUsage): AccountedUsage {
  const promptTokens = totalInputTokens(usage);
  return {
    promptTokens,
    completionTokens: usage.outputTokens,
    totalTokens: promptTokens + usage.outputTokens,
    uncachedInputTokens: usage.uncachedInputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
  };
}

/**
 * The metadata keys every proxy writes into `APIUsageLog.promptMetadata` so
 * the cache breakdown and pricing status are queryable per request.
 */
export function usageMetadata(usage: TokenUsage, cost: CostResult): {
  uncachedInputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  pricingMatched: boolean;
  pricingModel: string | null;
} {
  return {
    uncachedInputTokens: usage.uncachedInputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheCreationTokens: usage.cacheCreationTokens,
    pricingMatched: cost.pricingMatched,
    pricingModel: cost.matchedModel,
  };
}
