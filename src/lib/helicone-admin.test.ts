import test from "node:test";
import assert from "node:assert/strict";
import { normalizeHeliconeRequestRows, readHeliconeRequestPages } from "./helicone-admin";

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

function fakeRow(i: number) {
  return {
    request_id: `r${i}`,
    request_created_at: "2026-09-10T10:00:00Z",
    model: "gpt-4o",
    provider: "openai",
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    cost: 0.01,
    user_id: "dev@example.com",
  };
}

test("readHeliconeRequestPages stops on the first short page and reports pages", async () => {
  const offsets: number[] = [];
  const result = await readHeliconeRequestPages(
    async ({ offset, limit }) => {
      offsets.push(offset);
      const count = offset === 0 ? limit : 3;
      return { data: Array.from({ length: count }, (_, i) => fakeRow(offset + i)) };
    },
    { startTime: "2026-09-09T00:00:00Z", endTime: "2026-09-16T00:00:00Z", pageSize: 5, maxPages: 20 },
  );

  assert.deepEqual(offsets, [0, 5]);
  assert.equal(result.pages, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.rows.length, 8);
});

test("readHeliconeRequestPages flags truncation when every page up to the cap is full", async () => {
  let calls = 0;
  const result = await readHeliconeRequestPages(
    async ({ offset, limit }) => {
      calls++;
      return { data: Array.from({ length: limit }, (_, i) => fakeRow(offset + i)) };
    },
    { startTime: "2026-09-09T00:00:00Z", endTime: "2026-09-16T00:00:00Z", pageSize: 4, maxPages: 3 },
  );

  assert.equal(calls, 3);
  assert.equal(result.pages, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.rows.length, 12);
});
