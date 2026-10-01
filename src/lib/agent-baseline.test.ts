import test from "node:test";
import assert from "node:assert/strict";
import {
  computeBaseline,
  distribution,
  emptyDay,
  evaluateDrift,
  mergeDailyActivity,
  type DailyActivity,
} from "./agent-baseline";
import { mergeCatalogIntoConfig, isToolAllowed, isServerAllowed } from "./mcp-tool-governance";

function day(n: number, overrides: Partial<DailyActivity> = {}): DailyActivity {
  return {
    day: `2026-09-${String(n).padStart(2, "0")}`,
    requests: 100,
    toolCalls: 20,
    denied: 1,
    reviewRequired: 0,
    models: ["claude-sonnet-4-5"],
    tools: ["payments/issue_refund", "lookup_order"],
    users: ["runner@example.com"],
    hours: [9, 10, 11, 14, 15],
    ...overrides,
  };
}

const steady = Array.from({ length: 10 }, (_, i) => day(i + 1));

test("distribution handles empty and populated inputs", () => {
  assert.deepEqual(distribution([]), { mean: 0, stddev: 0, max: 0 });
  const d = distribution([10, 10, 10, 30]);
  assert.equal(d.mean, 15);
  assert.equal(d.max, 30);
  assert.ok(Math.abs(d.stddev - 8.66) < 0.01);
});

test("baseline uses active days only and aggregates sets", () => {
  const stats = computeBaseline([...steady, emptyDay("2026-09-11"), emptyDay("2026-09-12")], 28);
  assert.equal(stats.activeDays, 10);
  assert.equal(stats.totalRequests, 1000);
  assert.equal(stats.requestsPerDay.mean, 100);
  assert.equal(stats.denialRate, 10 / 200);
  assert.deepEqual(stats.models, ["claude-sonnet-4-5"]);
  assert.deepEqual(stats.activeHours, [9, 10, 11, 14, 15]);
});

test("immature baselines never report drift", () => {
  const stats = computeBaseline(steady.slice(0, 5), 28);
  assert.deepEqual(evaluateDrift(stats, day(30, { requests: 5000, models: ["gpt-5"] })), []);
});

test("steady traffic produces no findings", () => {
  const stats = computeBaseline(steady, 28);
  assert.deepEqual(evaluateDrift(stats, day(30)), []);
});

test("volume and tool-call spikes are HIGH", () => {
  const stats = computeBaseline(steady, 28);
  const findings = evaluateDrift(stats, day(30, { requests: 400, toolCalls: 90 }));
  assert.deepEqual(findings.map((f) => [f.kind, f.severity]), [
    ["volume_spike", "HIGH"],
    ["tool_call_spike", "HIGH"],
  ]);
  assert.match(findings[0].detail, /400 requests.*100\.0\/day/);
});

test("spike threshold needs both 3σ and 2× mean, with an absolute floor", () => {
  // Noisy baseline: stddev large, so 3σ is the binding constraint.
  const noisy = steady.map((d, i) => ({ ...d, requests: i % 2 ? 20 : 180 }));
  const stats = computeBaseline(noisy, 28);
  assert.deepEqual(evaluateDrift(stats, day(30, { requests: 250 })), []);
  // Tiny baseline: 2× mean is 4, but the floor of 10 prevents noise alerts.
  const tiny = steady.map((d) => ({ ...d, requests: 2, toolCalls: 1 }));
  const tinyStats = computeBaseline(tiny, 28);
  assert.deepEqual(evaluateDrift(tinyStats, day(30, { requests: 8, toolCalls: 4 })), []);
  assert.equal(evaluateDrift(tinyStats, day(30, { requests: 12, toolCalls: 1 }))[0]?.kind, "volume_spike");
});

test("denial-rate jump needs at least five denials and +20 points", () => {
  const stats = computeBaseline(steady, 28); // 5% baseline
  assert.deepEqual(evaluateDrift(stats, day(30, { toolCalls: 20, denied: 4 })), []);
  assert.deepEqual(evaluateDrift(stats, day(30, { toolCalls: 30, denied: 6 })), []); // 20%, not +20 points
  const f = evaluateDrift(stats, day(30, { toolCalls: 20, denied: 6 })); // 30%
  assert.equal(f[0]?.kind, "denial_rate");
  assert.match(f[0].detail, /30%.*5%/);
});

test("new model, new caller and off-hours activity are MEDIUM", () => {
  const stats = computeBaseline(steady, 28);
  const findings = evaluateDrift(
    stats,
    day(30, { models: ["claude-sonnet-4-5", "gpt-5"], users: ["runner@example.com", "intern@example.com"], hours: [9, 10, 23] })
  );
  assert.deepEqual(findings.map((f) => f.kind), ["new_model", "new_user", "off_hours"]);
  assert.ok(findings.every((f) => f.severity === "MEDIUM"));
  assert.match(findings[2].detail, /23:00 UTC.*09:00 and 15:00/);
});

test("off-hours is skipped for always-on agents", () => {
  const alwaysOn = steady.map((d) => ({ ...d, hours: Array.from({ length: 24 }, (_, h) => h) }));
  const stats = computeBaseline(alwaysOn, 28);
  assert.deepEqual(evaluateDrift(stats, day(30, { hours: [3] })), []);
});

test("mergeDailyActivity combines usage and tool-call rows", () => {
  const merged = mergeDailyActivity(
    { ...emptyDay("2026-09-01"), requests: 10, models: ["a"], hours: [9] },
    { toolCalls: 3, denied: 1, tools: ["x"], users: ["u"], hours: [10] }
  );
  assert.equal(merged.requests, 10);
  assert.equal(merged.toolCalls, 3);
  assert.deepEqual(merged.hours, [9, 10]);
  assert.deepEqual(merged.tools, ["x"]);
});

// ── catalog merge ────────────────────────────────────────────────────

test("catalog servers are additive and become the allowlist for agents without one", () => {
  const own = { serverAllowlist: [], toolAllowlist: [], enforcement: "monitor" as const };
  const merged = mergeCatalogIntoConfig(own, [
    { server: "jira", tools: [] },
    { server: "*.internal.example.com", tools: ["read"] },
  ]);
  assert.deepEqual(merged.serverAllowlist, ["jira", "*.internal.example.com"]);
  assert.deepEqual(merged.toolAllowlist, []); // no own tool list → no tool narrowing
  assert.equal(isServerAllowed({ name: "jira", host: null }, merged.serverAllowlist), true);
  assert.equal(isServerAllowed({ name: "notion", host: null }, merged.serverAllowlist), false);
  assert.equal(isToolAllowed({ kind: "mcp_tool_use", serverName: "docs", toolName: "write" }, { ...merged, serverAllowlist: [...merged.serverAllowlist, "docs"] }), true);
});

test("catalog tool lists narrow only agents that keep their own tool allowlist", () => {
  const own = { serverAllowlist: ["docs"], toolAllowlist: ["docs/search"], enforcement: "enforce" as const };
  const merged = mergeCatalogIntoConfig(own, [
    { server: "jira", tools: ["search_issues", "get_issue"] },
    { server: "notion", tools: [] },
  ]);
  assert.deepEqual(merged.serverAllowlist, ["docs", "jira", "notion"]);
  assert.deepEqual(merged.toolAllowlist, ["docs/search", "jira/search_issues", "jira/get_issue", "notion/*"]);
  assert.equal(isToolAllowed({ kind: "mcp_tool_use", serverName: "jira", toolName: "get_issue" }, merged), true);
  assert.equal(isToolAllowed({ kind: "mcp_tool_use", serverName: "jira", toolName: "delete_issue" }, merged), false);
  assert.equal(isToolAllowed({ kind: "mcp_tool_use", serverName: "notion", toolName: "anything" }, merged), true);
  assert.equal(isToolAllowed({ kind: "mcp_tool_use", serverName: "docs", toolName: "write" }, merged), false);
  assert.equal(merged.enforcement, "enforce");
});

test("empty catalog returns the agent's own config untouched", () => {
  const own = { serverAllowlist: ["a"], toolAllowlist: [], enforcement: "monitor" as const };
  assert.equal(mergeCatalogIntoConfig(own, []), own);
  assert.deepEqual(mergeCatalogIntoConfig(own, [{ server: "  ", tools: [] }]), own);
});
