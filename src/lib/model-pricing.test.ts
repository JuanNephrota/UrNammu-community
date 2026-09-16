import test from "node:test";
import assert from "node:assert/strict";
import {
  accountTokens,
  calculateCost,
  EMPTY_USAGE,
  isOpenAIUsageOnlyChunk,
  mergeAnthropicStreamUsage,
  mergeOpenAIStreamUsage,
  normalizeModelId,
  resolveModelPrice,
  usageFromAnthropic,
  usageFromOpenAI,
  usageMetadata,
} from "./model-pricing";

const close = (actual: number | null, expected: number) => {
  assert.ok(actual !== null, "expected a numeric cost");
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
};

// ── matching ────────────────────────────────────────────────────────────────

test("exact model ids match themselves", () => {
  assert.equal(resolveModelPrice("anthropic", "claude-fable-5-1")?.key, "claude-fable-5-1");
  assert.equal(resolveModelPrice("anthropic", "claude-opus-5")?.key, "claude-opus-5");
  assert.equal(resolveModelPrice("anthropic", "claude-sonnet-5")?.key, "claude-sonnet-5");
  assert.equal(resolveModelPrice("anthropic", "claude-haiku-4-5")?.key, "claude-haiku-4-5");
  assert.equal(resolveModelPrice("openai", "gpt-4o-mini")?.key, "gpt-4o-mini");
});

test("dated snapshots resolve to their family by longest prefix", () => {
  assert.equal(
    resolveModelPrice("anthropic", "claude-sonnet-5-20260101")?.key,
    "claude-sonnet-5"
  );
  assert.equal(
    resolveModelPrice("anthropic", "claude-fable-5-1-20260601")?.key,
    "claude-fable-5-1"
  );
  // `claude-fable-5-1-...` must not fall back to the shorter `claude-fable-5`.
  assert.notEqual(
    resolveModelPrice("anthropic", "claude-fable-5-1-20260601")?.key,
    "claude-fable-5"
  );
  assert.equal(resolveModelPrice("openai", "gpt-4o-mini-2024-07-18")?.key, "gpt-4o-mini");
  assert.equal(resolveModelPrice("openai", "gpt-4-turbo-2024-04-09")?.key, "gpt-4-turbo");
  assert.equal(resolveModelPrice("openai", "gpt-4-0613")?.key, "gpt-4");
  assert.equal(resolveModelPrice("openai", "o1-mini-2024-09-12")?.key, "o1-mini");
});

test("prefix matching respects the `-` boundary and never uses includes()", () => {
  // "gpt-4o" starts with "gpt-4" but is its own family.
  assert.equal(resolveModelPrice("openai", "gpt-4o")?.key, "gpt-4o");
  // "gpt-4o1" is not a family member of "gpt-4o" (no `-` boundary).
  assert.equal(resolveModelPrice("openai", "gpt-4o1"), null);
  // The old includes() logic would have matched "o1" inside "gpt-4o1-preview".
  assert.equal(resolveModelPrice("openai", "gpt-4o1-preview"), null);
  // A table key that CONTAINS the model must not match either.
  assert.equal(resolveModelPrice("anthropic", "claude"), null);
  assert.equal(resolveModelPrice("anthropic", "claude-opus"), null);
});

test("legacy provider names and cross-provider lookups", () => {
  assert.equal(resolveModelPrice("claude", "claude-opus-4-6")?.key, "claude-opus-4-6");
  assert.equal(resolveModelPrice("chatgpt", "gpt-4o")?.key, "gpt-4o");
  // Wrong table → no match, not a default.
  assert.equal(resolveModelPrice("openai", "claude-opus-5"), null);
  assert.equal(resolveModelPrice("anthropic", "gpt-4o"), null);
});

test("model ids are canonicalised before lookup", () => {
  assert.equal(normalizeModelId("  Claude-Opus-5 "), "claude-opus-5");
  assert.equal(normalizeModelId("us.anthropic.claude-opus-5"), "claude-opus-5");
  assert.equal(normalizeModelId("anthropic.claude-sonnet-4-6"), "claude-sonnet-4-6");
  assert.equal(normalizeModelId("claude-opus-4-5@20251101"), "claude-opus-4-5");
  assert.equal(
    resolveModelPrice("anthropic", "us.anthropic.claude-sonnet-5-20260101")?.key,
    "claude-sonnet-5"
  );
});

// ── cost math ───────────────────────────────────────────────────────────────

test("cost = uncached*input + cacheRead*read + cacheWrite*write + output*output", () => {
  const result = calculateCost("anthropic", "claude-opus-5", {
    uncachedInputTokens: 1_000_000,
    cacheReadTokens: 1_000_000,
    cacheCreationTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  // 5 + 0.5 + 6.25 + 25
  close(result.cost, 36.75);
  assert.equal(result.pricingMatched, true);
  assert.equal(result.matchedModel, "claude-opus-5");
});

test("fable 5.1 cache reads are priced at $0.25/MTok", () => {
  const result = calculateCost("anthropic", "claude-fable-5-1", {
    ...EMPTY_USAGE,
    cacheReadTokens: 2_000_000,
  });
  close(result.cost, 0.5);
});

test("openai cached tokens are charged at the cached rate", () => {
  const result = calculateCost("openai", "gpt-4o", {
    uncachedInputTokens: 500_000,
    cacheReadTokens: 500_000,
    cacheCreationTokens: 0,
    outputTokens: 100_000,
  });
  // 0.5*2.5 + 0.5*1.25 + 0.1*10
  close(result.cost, 1.25 + 0.625 + 1.0);
});

test("unknown models return null cost and pricingMatched=false, never a default", () => {
  const result = calculateCost("anthropic", "claude-mystery-9", {
    uncachedInputTokens: 1000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 1000,
  });
  assert.equal(result.cost, null);
  assert.equal(result.pricingMatched, false);
  assert.equal(result.matchedModel, null);
  assert.equal(calculateCost("openai", "unknown", EMPTY_USAGE).pricingMatched, false);
  assert.equal(calculateCost("openai", "", EMPTY_USAGE).pricingMatched, false);
});

test("zero usage on a known model costs zero but still reports a match", () => {
  const result = calculateCost("openai", "gpt-4o", EMPTY_USAGE);
  assert.equal(result.cost, 0);
  assert.equal(result.pricingMatched, true);
});

// ── usage normalisation ─────────────────────────────────────────────────────

test("anthropic input_tokens is uncached; totals include cache tokens", () => {
  const usage = usageFromAnthropic({
    input_tokens: 100,
    output_tokens: 40,
    cache_read_input_tokens: 900,
    cache_creation_input_tokens: 50,
  });
  assert.deepEqual(usage, {
    uncachedInputTokens: 100,
    cacheReadTokens: 900,
    cacheCreationTokens: 50,
    outputTokens: 40,
  });
  const accounted = accountTokens(usage);
  assert.equal(accounted.promptTokens, 1050);
  assert.equal(accounted.completionTokens, 40);
  assert.equal(accounted.totalTokens, 1090);
  assert.equal(accounted.cacheReadTokens, 900);
  assert.equal(accounted.cacheCreationTokens, 50);
});

test("openai prompt_tokens already includes cached tokens", () => {
  const usage = usageFromOpenAI({
    prompt_tokens: 1000,
    completion_tokens: 20,
    total_tokens: 1020,
    prompt_tokens_details: { cached_tokens: 800 },
  });
  assert.deepEqual(usage, {
    uncachedInputTokens: 200,
    cacheReadTokens: 800,
    cacheCreationTokens: 0,
    outputTokens: 20,
  });
  const accounted = accountTokens(usage);
  assert.equal(accounted.promptTokens, 1000);
  assert.equal(accounted.totalTokens, 1020);
});

test("openai cached_tokens is clamped to prompt_tokens and tolerates missing details", () => {
  assert.equal(
    usageFromOpenAI({ prompt_tokens: 10, prompt_tokens_details: { cached_tokens: 50 } })
      .uncachedInputTokens,
    0
  );
  assert.deepEqual(usageFromOpenAI({ prompt_tokens: 10, completion_tokens: 5 }), {
    uncachedInputTokens: 10,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    outputTokens: 5,
  });
  assert.deepEqual(usageFromOpenAI(undefined), EMPTY_USAGE);
  assert.deepEqual(usageFromAnthropic(null), EMPTY_USAGE);
});

test("anthropic stream: message_start sets input breakdown, message_delta finalises output", () => {
  let usage = EMPTY_USAGE;
  usage = mergeAnthropicStreamUsage(usage, {
    type: "message_start",
    message: {
      usage: {
        input_tokens: 12,
        cache_read_input_tokens: 3000,
        cache_creation_input_tokens: 400,
        output_tokens: 1,
      },
    },
  });
  usage = mergeAnthropicStreamUsage(usage, { type: "content_block_delta", delta: { text: "hi" } });
  usage = mergeAnthropicStreamUsage(usage, {
    type: "message_delta",
    delta: { stop_reason: "end_turn" },
    usage: { output_tokens: 250 },
  });
  assert.deepEqual(usage, {
    uncachedInputTokens: 12,
    cacheReadTokens: 3000,
    cacheCreationTokens: 400,
    outputTokens: 250,
  });
});

test("anthropic stream: cumulative input fields on message_delta override message_start", () => {
  let usage = mergeAnthropicStreamUsage(EMPTY_USAGE, {
    type: "message_start",
    message: { usage: { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 1 } },
  });
  usage = mergeAnthropicStreamUsage(usage, {
    type: "message_delta",
    usage: {
      input_tokens: 10,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 20,
      output_tokens: 99,
    },
  });
  assert.deepEqual(usage, {
    uncachedInputTokens: 10,
    cacheReadTokens: 500,
    cacheCreationTokens: 20,
    outputTokens: 99,
  });
  // Non-usage events and garbage leave the accumulator alone.
  assert.deepEqual(mergeAnthropicStreamUsage(usage, { type: "ping" }), usage);
  assert.deepEqual(mergeAnthropicStreamUsage(usage, null), usage);
  assert.deepEqual(mergeAnthropicStreamUsage(usage, "data"), usage);
});

test("openai stream: only the final usage chunk carries usage", () => {
  let usage = EMPTY_USAGE;
  usage = mergeOpenAIStreamUsage(usage, {
    choices: [{ delta: { content: "hel" } }],
    usage: null,
  });
  assert.deepEqual(usage, EMPTY_USAGE);
  usage = mergeOpenAIStreamUsage(usage, {
    choices: [],
    usage: {
      prompt_tokens: 300,
      completion_tokens: 40,
      prompt_tokens_details: { cached_tokens: 256 },
    },
  });
  assert.deepEqual(usage, {
    uncachedInputTokens: 44,
    cacheReadTokens: 256,
    cacheCreationTokens: 0,
    outputTokens: 40,
  });
});

test("isOpenAIUsageOnlyChunk identifies the trailing include_usage chunk", () => {
  assert.equal(
    isOpenAIUsageOnlyChunk({ choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } }),
    true
  );
  assert.equal(
    isOpenAIUsageOnlyChunk({ choices: [{ delta: {}, finish_reason: "stop" }], usage: null }),
    false
  );
  // A chunk with both choices and usage is a content chunk — keep it.
  assert.equal(
    isOpenAIUsageOnlyChunk({ choices: [{ delta: {} }], usage: { prompt_tokens: 1 } }),
    false
  );
  assert.equal(isOpenAIUsageOnlyChunk({ choices: [] }), false);
  assert.equal(isOpenAIUsageOnlyChunk("[DONE]"), false);
});

test("usageMetadata exposes the breakdown and pricing status", () => {
  const usage = usageFromAnthropic({
    input_tokens: 5,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 2,
    output_tokens: 1,
  });
  const cost = calculateCost("anthropic", "claude-nope", usage);
  assert.deepEqual(usageMetadata(usage, cost), {
    uncachedInputTokens: 5,
    cacheReadTokens: 10,
    cacheCreationTokens: 2,
    pricingMatched: false,
    pricingModel: null,
  });
  const matched = calculateCost("anthropic", "claude-haiku-4-5-20251001", usage);
  assert.equal(usageMetadata(usage, matched).pricingModel, "claude-haiku-4-5-20251001");
});
