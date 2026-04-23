import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePortkeyGraphPoints,
  normalizePortkeyGroupedRows,
} from "./portkey-admin";

test("normalizePortkeyGroupedRows reads model analytics rows", () => {
  const rows = normalizePortkeyGroupedRows(
    {
      data: [
        {
          ai_model: "openai/gpt-4o",
          requests: "12",
          cost: "4.25",
          total_units: "4200",
          prompt_tokens: "1800",
          completion_tokens: "2400",
          last_seen: "2026-04-21T08:00:00Z",
        },
      ],
    },
    ["ai_model"],
  );

  assert.deepEqual(rows, [
    {
      label: "openai/gpt-4o",
      requests: 12,
      cost: 4.25,
      totalTokens: 4200,
      promptTokens: 1800,
      completionTokens: 2400,
      lastSeenAt: "2026-04-21T08:00:00Z",
      raw: {
        ai_model: "openai/gpt-4o",
        requests: "12",
        cost: "4.25",
        total_units: "4200",
        prompt_tokens: "1800",
        completion_tokens: "2400",
        last_seen: "2026-04-21T08:00:00Z",
      },
    },
  ]);
});

test("normalizePortkeyGroupedRows falls back across user field aliases", () => {
  const rows = normalizePortkeyGroupedRows(
    {
      data: [
        {
          metadata_value: "team@example.com",
          requests: 3,
          req_units: 20,
          res_units: 10,
        },
      ],
    },
    ["user", "metadata_value"],
  );

  assert.equal(rows[0]?.label, "team@example.com");
  assert.equal(rows[0]?.promptTokens, 20);
  assert.equal(rows[0]?.completionTokens, 10);
  assert.equal(rows[0]?.totalTokens, 30);
});

test("normalizePortkeyGraphPoints reads time-series totals", () => {
  const rows = normalizePortkeyGraphPoints({
    data_points: [
      {
        timestamp: "2026-04-20T00:00:00Z",
        total: "1500",
        avg: "125",
      },
    ],
  });

  assert.deepEqual(rows, [
    {
      timestamp: "2026-04-20T00:00:00Z",
      total: 1500,
      avg: 125,
    },
  ]);
});
