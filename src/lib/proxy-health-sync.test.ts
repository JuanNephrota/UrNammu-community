import test from "node:test";
import assert from "node:assert/strict";
import type { ProxyHealthConfig, ProxyHealthWindow } from "./azure-monitor";
import {
  runProxyHealthSync,
  SYSTEM_ACTOR,
  type ProxyHealthSyncDeps,
} from "./proxy-health-sync";

const config: ProxyHealthConfig = {
  subscriptionId: "sub",
  resourceGroup: "rg",
  functionAppName: "nammu-ai-proxy",
  region: "eastus",
};

const health: ProxyHealthWindow = {
  windowStart: new Date("2026-09-16T10:00:00Z"),
  windowEnd: new Date("2026-09-16T10:15:00Z"),
  invocationCount: 42,
  http2xxCount: 40,
  http4xxCount: 1,
  http5xxCount: 1,
  avgResponseTimeMs: 812.5,
  rawMetrics: { metrics: [] },
};

function fakeDb() {
  const snapshots: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const db = {
    proxyHealthSnapshot: {
      create: (async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `snap-${snapshots.length + 1}`, capturedAt: new Date(), ...data };
        snapshots.push(row);
        return row;
      }) as unknown as NonNullable<ProxyHealthSyncDeps["db"]>["proxyHealthSnapshot"]["create"],
    },
    auditLog: {
      create: (async ({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return { id: `audit-${audits.length}`, ...data };
      }) as unknown as NonNullable<ProxyHealthSyncDeps["db"]>["auditLog"]["create"],
    },
  };
  return { db, snapshots, audits };
}

test("successful sync persists metrics and audit-logs a human actor", async () => {
  const { db, snapshots, audits } = fakeDb();
  const result = await runProxyHealthSync(config, "user-1", {
    db,
    fetchHealth: async () => health,
  });

  assert.equal(result.ok, true);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].invocationCount, 42);
  assert.equal(snapshots[0].http5xxCount, 1);
  assert.equal(snapshots[0].syncError, undefined);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].userId, "user-1");
  assert.equal(audits[0].action, "SYNC");
  assert.equal(audits[0].entityType, "ProxyHealth");
  assert.equal(audits[0].entityId, "snap-1");
});

test("system-triggered sync persists the snapshot without an audit row", async () => {
  const { db, snapshots, audits } = fakeDb();
  const result = await runProxyHealthSync(config, SYSTEM_ACTOR, {
    db,
    fetchHealth: async () => health,
  });

  assert.equal(result.ok, true);
  assert.equal(snapshots.length, 1);
  assert.equal(audits.length, 0, "AuditLog.userId is a User FK; system runs are not audited");
});

test("failed Monitor query persists a syncError snapshot covering the trailing window", async () => {
  const { db, snapshots, audits } = fakeDb();
  const fixedNow = new Date("2026-09-16T12:00:00Z");
  const result = await runProxyHealthSync(config, SYSTEM_ACTOR, {
    db,
    now: () => fixedNow,
    fetchHealth: async () => {
      throw new Error("AADSTS700016: application not found");
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /AADSTS700016/);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].syncError, "AADSTS700016: application not found");
  assert.equal((snapshots[0].windowEnd as Date).toISOString(), fixedNow.toISOString());
  assert.equal(
    (snapshots[0].windowStart as Date).toISOString(),
    new Date(fixedNow.getTime() - 15 * 60 * 1000).toISOString()
  );
  assert.equal(audits.length, 0);
});

test("fetchHealth receives the config and the 15-minute window", async () => {
  const { db } = fakeDb();
  let seen: { config: ProxyHealthConfig; minutes: number | undefined } | null = null;
  await runProxyHealthSync(config, "user-1", {
    db,
    fetchHealth: async (c, minutes) => {
      seen = { config: c, minutes };
      return health;
    },
  });
  assert.deepEqual(seen, { config, minutes: 15 });
});
