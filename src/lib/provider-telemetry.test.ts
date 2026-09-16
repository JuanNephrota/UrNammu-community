import test from "node:test";
import assert from "node:assert/strict";
import { planPortkeyDayBuckets } from "./provider-telemetry";
import type { PortkeyGroupedRow } from "./portkey-admin";

function row(partial: Partial<PortkeyGroupedRow> & { label: string }): PortkeyGroupedRow {
  return {
    requests: 0,
    cost: 0,
    totalTokens: 0,
    promptTokens: 0,
    completionTokens: 0,
    hasTokenSplit: false,
    lastSeenAt: null,
    raw: {},
    ...partial,
  };
}

test("planPortkeyDayBuckets writes one model bucket + cost bucket per model with a shared dimensionKey", () => {
  const plan = planPortkeyDayBuckets({
    date: "2026-09-15",
    modelRows: [
      row({
        label: "openai/gpt-4o",
        requests: 12,
        cost: 425, // cents
        totalTokens: 4200,
        promptTokens: 1800,
        completionTokens: 2400,
        hasTokenSplit: true,
        lastSeenAt: "2026-09-15T08:00:00Z",
      }),
    ],
    userRows: [],
  });

  assert.equal(plan.usageBuckets.length, 1);
  const usage = plan.usageBuckets[0]!;
  assert.equal(usage.partition, "model");
  assert.equal(usage.dimensionKey, "date=2026-09-15|model=openai/gpt-4o");
  assert.equal(usage.model, "openai/gpt-4o");
  assert.equal(usage.actorExternalId, null);
  assert.equal(usage.inputTokens, 1800);
  assert.equal(usage.outputTokens, 2400);
  assert.equal(usage.totalTokens, 4200);
  assert.equal(usage.requestCount, 12);
  assert.equal(usage.costUsd, 4.25);
  assert.equal(usage.metadata.tokenSplitAvailable, true);
  assert.equal(usage.metadata.costCents, 425);

  assert.equal(plan.costBuckets.length, 1);
  const cost = plan.costBuckets[0]!;
  assert.equal(cost.dimensionKey, usage.dimensionKey);
  assert.equal(cost.model, "openai/gpt-4o");
  assert.equal(cost.amount, 4.25);

  assert.deepEqual(plan.actors, []);
  assert.equal(plan.totals.modelTokens, 4200);
  assert.equal(plan.totals.modelCostUsd, 4.25);
  assert.equal(plan.totals.modelRequests, 12);
});

test("planPortkeyDayBuckets does not fabricate an input/output split when Portkey only returns totals", () => {
  const plan = planPortkeyDayBuckets({
    date: "2026-09-15",
    modelRows: [row({ label: "anthropic/claude-sonnet-4", requests: 3, totalTokens: 900, hasTokenSplit: false })],
    userRows: [],
  });

  const usage = plan.usageBuckets[0]!;
  assert.equal(usage.totalTokens, 900);
  // UsageBucket.inputTokens/outputTokens are NOT NULL columns, so "unknown"
  // is encoded as 0 + tokenSplitAvailable=false, never as total/0.
  assert.equal(usage.inputTokens, 0);
  assert.equal(usage.outputTokens, 0);
  assert.equal(usage.metadata.tokenSplitAvailable, false);
  // Zero cost => no CostBucket.
  assert.equal(plan.costBuckets.length, 0);
});

test("planPortkeyDayBuckets writes actor-partition buckets with the actor in the dimensionKey and cost in metadata", () => {
  const plan = planPortkeyDayBuckets({
    date: "2026-09-15",
    modelRows: [],
    userRows: [
      row({ label: "alice@example.com", requests: 7, cost: 130, totalTokens: 500, lastSeenAt: "2026-09-15T09:00:00Z" }),
      row({ label: "svc-bot", requests: 1, cost: 5 }),
    ],
  });

  assert.equal(plan.usageBuckets.length, 2);
  const alice = plan.usageBuckets[0]!;
  assert.equal(alice.partition, "actor");
  assert.equal(alice.dimensionKey, "actorExternalId=alice@example.com|date=2026-09-15|partition=actor");
  assert.equal(alice.model, null);
  assert.equal(alice.actorExternalId, "alice@example.com");
  assert.equal(alice.actorName, "alice@example.com");
  assert.equal(alice.totalTokens, 500);
  assert.equal(alice.requestCount, 7);
  assert.equal(alice.costUsd, 1.3);
  assert.equal(alice.metadata.costCents, 130);
  assert.equal(alice.metadata.partition, "actor");

  // Actor cost lives in metadata only — never a second CostBucket.
  assert.equal(plan.costBuckets.length, 0);

  assert.deepEqual(
    plan.actors.map((actor) => [actor.externalId, actor.email]),
    [
      ["alice@example.com", "alice@example.com"],
      ["svc-bot", null],
    ],
  );
  assert.equal(plan.totals.actorTokens, 500);
  assert.equal(plan.totals.actorRequests, 8);
  assert.equal(plan.totals.actorCostUsd, 1.35);
});

test("planPortkeyDayBuckets merges duplicate labels and skips unlabeled rows", () => {
  const plan = planPortkeyDayBuckets({
    date: "2026-09-15",
    modelRows: [
      row({ label: "m", requests: 1, cost: 10, totalTokens: 100, promptTokens: 60, completionTokens: 40, hasTokenSplit: true }),
      row({ label: "m", requests: 2, cost: 20, totalTokens: 200, promptTokens: 120, completionTokens: 80, hasTokenSplit: true }),
      { ...row({ label: "x" }), label: null, requests: 99, totalTokens: 999 },
    ],
    userRows: [],
  });

  assert.equal(plan.usageBuckets.length, 1);
  const merged = plan.usageBuckets[0]!;
  assert.equal(merged.requestCount, 3);
  assert.equal(merged.totalTokens, 300);
  assert.equal(merged.inputTokens, 180);
  assert.equal(merged.outputTokens, 120);
  assert.equal(merged.costUsd, 0.3);
  assert.equal(plan.costBuckets[0]?.amount, 0.3);
});

test("planPortkeyDayBuckets keeps model and actor partitions distinct for the same day", () => {
  const plan = planPortkeyDayBuckets({
    date: "2026-09-15",
    modelRows: [row({ label: "m", requests: 1, totalTokens: 10 })],
    userRows: [row({ label: "u", requests: 1, totalTokens: 10 })],
  });

  const keys = plan.usageBuckets.map((bucket) => bucket.dimensionKey);
  assert.equal(new Set(keys).size, 2);
  assert.ok(keys.some((key) => key.includes("model=m") && !key.includes("partition=actor")));
  assert.ok(keys.some((key) => key.includes("actorExternalId=u") && key.includes("partition=actor")));
});
