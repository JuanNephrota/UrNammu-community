const ANTHROPIC_PRICING: Record<string, { input: number; output: number }> = {
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
