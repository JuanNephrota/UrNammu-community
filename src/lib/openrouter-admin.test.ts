import test from "node:test";
import assert from "node:assert/strict";
import { normalizeOpenRouterActivityRows } from "./openrouter-admin";

test("normalizeOpenRouterActivityRows parses activity rows", () => {
  const rows = normalizeOpenRouterActivityRows({
    data: [
      {
        date: "2026-04-20",
        model: "openai/gpt-4.1",
        model_permaslug: "openai/gpt-4.1-2025-04-14",
        endpoint_id: "endpoint-1",
        provider_name: "openai",
        usage: 1.23,
        byok_usage_inference: 0.12,
        requests: 42,
        prompt_tokens: 1500,
        completion_tokens: 800,
        reasoning_tokens: 200,
      },
    ],
  });

  assert.deepEqual(rows, [
    {
      date: "2026-04-20",
      model: "openai/gpt-4.1",
      modelPermaslug: "openai/gpt-4.1-2025-04-14",
      endpointId: "endpoint-1",
      providerName: "openai",
      usage: 1.23,
      byokUsageInference: 0.12,
      requests: 42,
      promptTokens: 1500,
      completionTokens: 800,
      reasoningTokens: 200,
    },
  ]);
});
