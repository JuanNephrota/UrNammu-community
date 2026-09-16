import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPortkeyDayWindows,
  normalizePortkeyGraphPoints,
  normalizePortkeyGroupedRows,
  portkeyCostToUsd,
  readPortkeyGroupedPages,
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
      hasTokenSplit: true,
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
  assert.equal(rows[0]?.hasTokenSplit, true);
});

test("normalizePortkeyGroupedRows does not fabricate a split when only totals exist", () => {
  const rows = normalizePortkeyGroupedRows(
    {
      data: [
        { ai_model: "anthropic/claude-sonnet-4", requests: 5, cost: 250, total_units: 900 },
        // Documented users-endpoint shape: no token fields at all.
        { user: "someone@example.com", requests: "2", cost: "30" },
      ],
    },
    ["ai_model", "user"],
  );

  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.totalTokens, 900);
  assert.equal(rows[0]?.promptTokens, 0);
  assert.equal(rows[0]?.completionTokens, 0);
  assert.equal(rows[0]?.hasTokenSplit, false);
  assert.equal(rows[1]?.label, "someone@example.com");
  assert.equal(rows[1]?.totalTokens, 0);
  assert.equal(rows[1]?.hasTokenSplit, false);
  assert.equal(rows[1]?.cost, 30);
});

test("portkeyCostToUsd converts Portkey cents to dollars", () => {
  assert.equal(portkeyCostToUsd(425), 4.25);
  assert.equal(portkeyCostToUsd(0), 0);
  assert.equal(portkeyCostToUsd(Number.NaN), 0);
});

test("buildPortkeyDayWindows splits a 7-day window into full UTC-day buckets", () => {
  const end = new Date("2026-09-16T15:30:00.000Z");
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000); // 2026-09-09T15:30Z
  const windows = buildPortkeyDayWindows(start, end);

  // Partial first day + 6 full days + partial current day.
  assert.equal(windows.length, 8);
  assert.equal(windows[0]?.date, "2026-09-09");
  assert.equal(windows[0]?.bucketStart.toISOString(), "2026-09-09T00:00:00.000Z");
  assert.equal(windows[0]?.bucketEnd.toISOString(), "2026-09-10T00:00:00.000Z");
  // Query bounds are clamped to the requested window; bucket bounds are not.
  assert.equal(windows[0]?.startTime, "2026-09-09T15:30:00.000Z");
  assert.equal(windows[0]?.endTime, "2026-09-10T00:00:00.000Z");

  const last = windows[windows.length - 1];
  assert.equal(last?.date, "2026-09-16");
  assert.equal(last?.startTime, "2026-09-16T00:00:00.000Z");
  assert.equal(last?.endTime, "2026-09-16T15:30:00.000Z");
  assert.equal(last?.bucketEnd.toISOString(), "2026-09-17T00:00:00.000Z");

  for (let i = 1; i < windows.length; i++) {
    assert.equal(windows[i]?.bucketStart.getTime(), windows[i - 1]?.bucketEnd.getTime());
  }
});

test("buildPortkeyDayWindows returns a single window for a same-day range and nothing for an empty range", () => {
  const single = buildPortkeyDayWindows(
    new Date("2026-09-16T01:00:00.000Z"),
    new Date("2026-09-16T02:00:00.000Z"),
  );
  assert.equal(single.length, 1);
  assert.equal(single[0]?.date, "2026-09-16");

  assert.deepEqual(
    buildPortkeyDayWindows(new Date("2026-09-16T02:00:00.000Z"), new Date("2026-09-16T01:00:00.000Z")),
    [],
  );
});

test("readPortkeyGroupedPages follows pages until a short page", async () => {
  const calls: number[] = [];
  const result = await readPortkeyGroupedPages(
    async ({ currentPage, pageSize }) => {
      calls.push(currentPage);
      const count = currentPage < 2 ? pageSize : 1;
      return {
        data: Array.from({ length: count }, (_, i) => ({
          ai_model: `model-${currentPage}-${i}`,
          requests: 1,
        })),
      };
    },
    { startTime: "2026-09-15T00:00:00Z", endTime: "2026-09-16T00:00:00Z", labelKeys: ["ai_model"], pageSize: 3 },
  );

  assert.deepEqual(calls, [0, 1, 2]);
  assert.equal(result.pages, 3);
  assert.equal(result.rows.length, 7);
  assert.equal(result.truncated, false);
});

test("readPortkeyGroupedPages flags truncation when the page cap is hit on a full page", async () => {
  let calls = 0;
  const result = await readPortkeyGroupedPages(
    async ({ pageSize }) => {
      calls++;
      return { data: Array.from({ length: pageSize }, (_, i) => ({ user: `u${calls}-${i}`, requests: 1 })) };
    },
    {
      startTime: "2026-09-15T00:00:00Z",
      endTime: "2026-09-16T00:00:00Z",
      labelKeys: ["user"],
      pageSize: 2,
      maxPages: 3,
    },
  );

  assert.equal(calls, 3);
  assert.equal(result.pages, 3);
  assert.equal(result.rows.length, 6);
  assert.equal(result.truncated, true);
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
