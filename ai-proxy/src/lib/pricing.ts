const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
  // Current bare model IDs (no date suffix). Listed first so current requests
  // resolve to current pricing — calculateCost uses substring matching
  // (model.includes(key) || key.includes(model)) and returns the first hit.
  "claude-opus-4-8": { input: 5.0, output: 25.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  "claude-fable-5": { input: 10.0, output: 50.0 },
  // Deprecated dated IDs kept for any in-flight traffic still using them.
  "claude-sonnet-4-20250514": { input: 3.0, output: 15.0 },
  "claude-haiku-4-5-20251001": { input: 0.8, output: 4.0 },
  "claude-opus-4-20250514": { input: 15.0, output: 75.0 },
};

const OPENAI_PRICING: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
  "gpt-4": { input: 30.0, output: 60.0 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "o1": { input: 15.0, output: 60.0 },
  "o1-mini": { input: 3.0, output: 12.0 },
};

export function calculateCost(
  provider: "claude" | "chatgpt",
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const table = provider === "claude" ? ANTHROPIC_PRICING : OPENAI_PRICING;
  const defaultPricing = provider === "claude"
    ? { input: 3.0, output: 15.0 }
    : { input: 5.0, output: 15.0 };

  const pricing = Object.entries(table).find(
    ([key]) => model.includes(key) || key.includes(model)
  )?.[1] ?? defaultPricing;

  return (
    (inputTokens / 1_000_000) * pricing.input +
    (outputTokens / 1_000_000) * pricing.output
  );
}
