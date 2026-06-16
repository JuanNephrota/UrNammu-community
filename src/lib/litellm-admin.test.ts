import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLiteLLMSpendRows } from "./litellm-admin";

test("normalizeLiteLLMSpendRows reads bare-array spend logs", () => {
  const rows = normalizeLiteLLMSpendRows([
    {
      request_id: "req_1",
      startTime: "2026-04-22T12:00:00.000Z",
      endTime: "2026-04-22T12:00:03.000Z",
      model: "gpt-4o-mini",
      custom_llm_provider: "openai",
      call_type: "completion",
      user: "alice@example.com",
      api_key: "sk-abc",
      key_alias: "alice-laptop",
      team_id: "team_1",
      team_alias: "growth",
      prompt_tokens: 120,
      completion_tokens: 30,
      total_tokens: 150,
      spend: 0.0025,
      status: "success",
    },
    {
      request_id: "req_2",
      start_time: "2026-04-22T13:00:00.000Z",
      model: "claude-sonnet-4-20250514",
      metadata: { custom_llm_provider: "anthropic" },
      prompt_tokens: 80,
      completion_tokens: 20,
      spend: 0.001,
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].model, "gpt-4o-mini");
  assert.equal(rows[0].provider, "openai");
  assert.equal(rows[0].totalTokens, 150);
  assert.equal(rows[0].apiKeyName, "alice-laptop");

  assert.equal(rows[1].startTime, "2026-04-22T13:00:00.000Z");
  assert.equal(rows[1].provider, "anthropic");
  assert.equal(rows[1].totalTokens, 100);
  assert.equal(rows[1].cost, 0.001);
});

test("normalizeLiteLLMSpendRows also reads { data: [...] } wrapped responses", () => {
  const rows = normalizeLiteLLMSpendRows({
    data: [
      {
        startTime: "2026-04-22T14:00:00.000Z",
        model: "claude-haiku",
        prompt_tokens: 10,
        completion_tokens: 5,
        spend: 0.0001,
      },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].totalTokens, 15);
});

test("normalizeLiteLLMSpendRows drops rows without a start time", () => {
  const rows = normalizeLiteLLMSpendRows([
    { model: "gpt-4o", prompt_tokens: 5, completion_tokens: 5, spend: 0 },
    { startTime: "2026-04-22T12:00:00.000Z", model: "gpt-4o", prompt_tokens: 5, completion_tokens: 5, spend: 0 },
  ]);
  assert.equal(rows.length, 1);
});
