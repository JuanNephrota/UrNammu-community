import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHeliconeRequestRows } from "./helicone-admin";

test("normalizeHeliconeRequestRows reads flat and wrapped rows", () => {
  const rows = normalizeHeliconeRequestRows({
    data: [
      {
        request_response_rmt: {
          request_created_at: "2026-04-20T12:00:00.000Z",
          provider: "openai",
          model: "gpt-4o-mini",
          prompt_tokens: 120,
          completion_tokens: 30,
          total_tokens: 150,
          cost: 0.0025,
          user_id: "alice@example.com",
          status: 200,
        },
      },
      {
        request_created_at: "2026-04-20T13:00:00.000Z",
        provider: "anthropic",
        model: "claude-sonnet-4-20250514",
        prompt_tokens: 80,
        completion_tokens: 20,
        cost: 0.001,
        user_id: "bob@example.com",
        status: 200,
      },
    ],
  });

  assert.deepEqual(rows, [
    {
      requestCreatedAt: "2026-04-20T12:00:00.000Z",
      provider: "openai",
      model: "gpt-4o-mini",
      promptTokens: 120,
      completionTokens: 30,
      totalTokens: 150,
      cost: 0.0025,
      userId: "alice@example.com",
      status: 200,
    },
    {
      requestCreatedAt: "2026-04-20T13:00:00.000Z",
      provider: "anthropic",
      model: "claude-sonnet-4-20250514",
      promptTokens: 80,
      completionTokens: 20,
      totalTokens: 100,
      cost: 0.001,
      userId: "bob@example.com",
      status: 200,
    },
  ]);
});
