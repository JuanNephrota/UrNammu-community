import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLLECTION_RETENTION_DEFAULTS,
  COLLECTION_RETENTION_SETTINGS_KEYS,
  PRUNE_BATCH_SIZE,
  RETENTION_DEFAULTS,
  RETENTION_ENV_VARS,
  pruneInBatches,
  resolveRetentionDays,
  retentionCutoff,
  selectScanIdsToPrune,
  type PruneBatchRow,
  type PruneSource,
} from "./collection-retention";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("resolveRetentionDays", () => {
  it("returns the fallback when unset", () => {
    assert.equal(resolveRetentionDays(null, 14), 14);
    assert.equal(resolveRetentionDays(undefined, 14), 14);
    assert.equal(resolveRetentionDays("", 14), 14);
    assert.equal(resolveRetentionDays("   ", 14), 14);
  });

  it("parses whole-day values, including 0 (disabled)", () => {
    assert.equal(resolveRetentionDays("90", 14), 90);
    assert.equal(resolveRetentionDays(" 7 ", 14), 7);
    assert.equal(resolveRetentionDays("0", 14), 0);
  });

  it("falls back on negative, fractional or garbage input", () => {
    assert.equal(resolveRetentionDays("-5", 14), 14);
    assert.equal(resolveRetentionDays("1.5", 14), 14);
    assert.equal(resolveRetentionDays("30d", 14), 14);
    assert.equal(resolveRetentionDays("abc", 14), 14);
    assert.equal(resolveRetentionDays("1e3", 14), 14);
  });
});

describe("retentionCutoff", () => {
  it("subtracts whole days from now", () => {
    const now = new Date("2026-09-16T03:45:00.000Z");
    assert.equal(
      retentionCutoff(14, now).toISOString(),
      "2026-09-02T03:45:00.000Z"
    );
    assert.equal(
      retentionCutoff(365, now).toISOString(),
      "2025-09-16T03:45:00.000Z"
    );
  });

  it("refuses a zero or negative window (0 means disabled, never 'delete everything')", () => {
    assert.throws(() => retentionCutoff(0), RangeError);
    assert.throws(() => retentionCutoff(-1), RangeError);
    assert.throws(() => retentionCutoff(Number.NaN), RangeError);
  });
});

describe("retention settings catalog", () => {
  it("has a default and an env fallback for every collection setting", () => {
    for (const key of Object.values(COLLECTION_RETENTION_SETTINGS_KEYS)) {
      assert.ok(COLLECTION_RETENTION_DEFAULTS[key] > 0, `${key} default`);
      assert.match(RETENTION_ENV_VARS[key], /^[A-Z_]+_RETENTION_DAYS$/);
    }
  });

  it("matches the plan's default windows", () => {
    assert.deepEqual(COLLECTION_RETENTION_DEFAULTS, {
      raw_snapshot_retention_days: 14,
      api_usage_log_retention_days: 180,
      agent_tool_call_retention_days: 180,
      policy_denial_retention_days: 365,
      proxy_health_retention_days: 90,
      scan_result_retention_days: 365,
    });
  });

  it("covers the two OTel prune crons, including the Cursor env fallback", () => {
    assert.equal(
      RETENTION_ENV_VARS.cursor_telemetry_retention_days,
      "CURSOR_TELEMETRY_RETENTION_DAYS"
    );
    assert.equal(RETENTION_DEFAULTS.cursor_telemetry_retention_days, 30);
    assert.equal(RETENTION_DEFAULTS.claude_code_telemetry_retention_days, 30);
  });

  it("never lists the aggregate bucket tables", () => {
    for (const key of Object.keys(RETENTION_ENV_VARS)) {
      assert.doesNotMatch(key, /bucket/i);
    }
  });
});

/** In-memory table that behaves like the Prisma-backed sources in the route. */
function fakeSource(rows: PruneBatchRow[]) {
  const table = new Map(rows.map((r) => [r.id, r]));
  const calls: Array<{ cutoff: Date; take: number; after: Date | null }> = [];
  const deletes: string[][] = [];
  const source: PruneSource = {
    async findOldest(cutoff, take, after) {
      calls.push({ cutoff, take, after });
      return [...table.values()]
        .filter(
          (r) =>
            r.ts.getTime() < cutoff.getTime() &&
            (after == null || r.ts.getTime() >= after.getTime())
        )
        .sort((a, b) => a.ts.getTime() - b.ts.getTime())
        .slice(0, take);
    },
    async deleteByIds(ids) {
      deletes.push(ids);
      let n = 0;
      for (const id of ids) if (table.delete(id)) n += 1;
      return n;
    },
    async countRemaining(cutoff) {
      return [...table.values()].filter((r) => r.ts.getTime() < cutoff.getTime()).length;
    },
  };
  return { source, table, calls, deletes };
}

function rowsAt(base: Date, count: number, stepMs: number): PruneBatchRow[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `row-${i}`,
    ts: new Date(base.getTime() + i * stepMs),
  }));
}

describe("pruneInBatches", () => {
  const cutoff = new Date("2026-09-01T00:00:00.000Z");

  it("uses a 5,000-row batch by default", () => {
    assert.equal(PRUNE_BATCH_SIZE, 5000);
  });

  it("deletes only rows older than the cutoff", async () => {
    const old = rowsAt(new Date("2026-08-01T00:00:00.000Z"), 3, DAY_MS);
    const fresh = rowsAt(new Date("2026-09-10T00:00:00.000Z"), 2, DAY_MS).map((r) => ({
      ...r,
      id: `fresh-${r.id}`,
    }));
    const { source, table } = fakeSource([...old, ...fresh]);

    const result = await pruneInBatches(source, { cutoff, batchSize: 10 });

    assert.deepEqual(result, { deleted: 3, remaining: 0, batches: 1, budgetExhausted: false });
    assert.deepEqual([...table.keys()].sort(), ["fresh-row-0", "fresh-row-1"]);
  });

  it("walks the backlog in fixed batches and advances the cursor", async () => {
    const { source, table, calls, deletes } = fakeSource(
      rowsAt(new Date("2026-01-01T00:00:00.000Z"), 25, 60_000)
    );

    const result = await pruneInBatches(source, { cutoff, batchSize: 10 });

    assert.deepEqual(result, { deleted: 25, remaining: 0, batches: 3, budgetExhausted: false });
    assert.deepEqual(deletes.map((d) => d.length), [10, 10, 5]);
    assert.equal(table.size, 0);
    // First batch starts from the beginning, later ones from the last ts seen.
    assert.equal(calls[0].after, null);
    assert.equal(calls[1].after?.toISOString(), "2026-01-01T00:09:00.000Z");
    assert.equal(calls[2].after?.toISOString(), "2026-01-01T00:19:00.000Z");
    assert.ok(calls.every((c) => c.take === 10));
  });

  it("does not issue a trailing empty query when a batch exactly fills", async () => {
    const { source, calls } = fakeSource(
      rowsAt(new Date("2026-01-01T00:00:00.000Z"), 20, 60_000)
    );

    const result = await pruneInBatches(source, { cutoff, batchSize: 10 });

    assert.equal(result.deleted, 20);
    assert.equal(result.batches, 2);
    // Two full batches, then one probe that finds nothing.
    assert.equal(calls.length, 3);
  });

  it("stops at the deadline and reports what is left", async () => {
    const { source, table } = fakeSource(
      rowsAt(new Date("2026-01-01T00:00:00.000Z"), 30, 60_000)
    );
    let tick = 0;
    // Each check advances the clock; the deadline hits before the third batch.
    const now = () => tick++ * 100;

    const result = await pruneInBatches(source, {
      cutoff,
      batchSize: 10,
      deadline: 150,
      now,
    });

    assert.equal(result.deleted, 20);
    assert.equal(result.batches, 2);
    assert.equal(result.remaining, 10);
    assert.equal(result.budgetExhausted, true);
    assert.equal(table.size, 10);
  });

  it("is a no-op on an empty table", async () => {
    const { source, deletes } = fakeSource([]);
    const result = await pruneInBatches(source, { cutoff });
    assert.deepEqual(result, { deleted: 0, remaining: 0, batches: 0, budgetExhausted: false });
    assert.equal(deletes.length, 0);
  });

  it("rejects a non-positive batch size", async () => {
    const { source } = fakeSource([]);
    await assert.rejects(pruneInBatches(source, { cutoff, batchSize: 0 }), RangeError);
  });
});

describe("selectScanIdsToPrune", () => {
  const cutoff = new Date("2025-09-16T00:00:00.000Z");
  const at = (iso: string) => new Date(iso);

  it("prunes old scans but keeps the newest overall", () => {
    const ids = selectScanIdsToPrune(
      [
        { id: "a", createdAt: at("2024-01-01T00:00:00Z"), providers: [] },
        { id: "b", createdAt: at("2024-06-01T00:00:00Z"), providers: [] },
        { id: "c", createdAt: at("2024-12-01T00:00:00Z"), providers: [] },
      ],
      cutoff
    );
    assert.deepEqual(ids.sort(), ["a", "b"]);
  });

  it("keeps the newest scan per provider even when it is older than the cutoff", () => {
    const ids = selectScanIdsToPrune(
      [
        // Only scan that ever covered portkey — must survive.
        { id: "old-portkey", createdAt: at("2024-01-01T00:00:00Z"), providers: ["portkey", "openai"] },
        { id: "old-openai", createdAt: at("2024-03-01T00:00:00Z"), providers: ["openai"] },
        { id: "mid", createdAt: at("2025-01-01T00:00:00Z"), providers: ["anthropic", "openai"] },
        { id: "recent", createdAt: at("2026-09-01T00:00:00Z"), providers: ["anthropic"] },
      ],
      cutoff
    );
    assert.deepEqual(ids, ["old-openai"]);
  });

  it("does not prune anything newer than the cutoff", () => {
    const ids = selectScanIdsToPrune(
      [
        { id: "x", createdAt: at("2026-01-01T00:00:00Z"), providers: ["a"] },
        { id: "y", createdAt: at("2026-02-01T00:00:00Z"), providers: ["a"] },
        { id: "z", createdAt: at("2026-03-01T00:00:00Z"), providers: ["a"] },
      ],
      cutoff
    );
    assert.deepEqual(ids, []);
  });

  it("is independent of input order", () => {
    const scans = [
      { id: "1", createdAt: at("2024-05-01T00:00:00Z"), providers: [] },
      { id: "2", createdAt: at("2024-04-01T00:00:00Z"), providers: [] },
      { id: "3", createdAt: at("2026-09-01T00:00:00Z"), providers: [] },
    ];
    assert.deepEqual(selectScanIdsToPrune(scans, cutoff), ["1", "2"]);
    assert.deepEqual(selectScanIdsToPrune([...scans].reverse(), cutoff), ["1", "2"]);
  });

  it("handles an empty list", () => {
    assert.deepEqual(selectScanIdsToPrune([], cutoff), []);
  });
});
