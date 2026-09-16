import test from "node:test";
import assert from "node:assert/strict";
import { rankCostByKey, summarizeCostBySystem } from "./cost-attribution";

test("summarizeCostBySystem splits attributed vs unattributed spend and ranks systems", () => {
  const summary = summarizeCostBySystem(
    [
      { aiSystemId: null, systemName: null, department: null, amount: 30, providers: ["openai"] },
      { aiSystemId: "sys_a", systemName: "Support Bot", department: "CX", amount: 50, providers: ["anthropic"] },
      { aiSystemId: "sys_b", systemName: "Code Assist", department: "Eng", amount: 20, providers: ["anthropic", "litellm"] },
      { aiSystemId: "sys_zero", systemName: "Idle", department: "Eng", amount: 0, providers: [] },
    ],
    1
  );
  assert.equal(summary.rows.length, 1);
  assert.equal(summary.rows[0]!.systemName, "Support Bot");
  assert.equal(summary.attributedAmount, 70);
  assert.equal(summary.unattributedAmount, 30);
  assert.equal(summary.totalAmount, 100);
  assert.equal(summary.coveragePct, 70);
});

test("summarizeCostBySystem treats a dangling aiSystemId (deleted system) as unattributed", () => {
  const summary = summarizeCostBySystem([
    { aiSystemId: "sys_gone", systemName: null, department: null, amount: 10, providers: ["openai"] },
  ]);
  assert.equal(summary.rows.length, 0);
  assert.equal(summary.unattributedAmount, 10);
  assert.equal(summary.coveragePct, 0);
});

test("summarizeCostBySystem reports 0% coverage with no spend instead of NaN", () => {
  const summary = summarizeCostBySystem([]);
  assert.equal(summary.coveragePct, 0);
  assert.equal(summary.totalAmount, 0);
});

test("rankCostByKey interleaves key and workspace rows by amount and drops zero rows", () => {
  const ranked = rankCostByKey(
    [
      { provider: "litellm", scope: "api_key", externalId: "k1", label: "team-a", systemName: null, workspaceName: null, amount: 5 },
      { provider: "anthropic", scope: "workspace", externalId: "wrkspc_1", label: "Prod", systemName: "Support Bot", workspaceName: "Prod", amount: 12 },
      { provider: "openai", scope: "api_key", externalId: "k2", label: "svc", systemName: null, workspaceName: null, amount: 0 },
    ],
    5
  );
  assert.deepEqual(ranked.map((r) => r.externalId), ["wrkspc_1", "k1"]);
});
