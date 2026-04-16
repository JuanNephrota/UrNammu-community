import test from "node:test";
import assert from "node:assert/strict";
import {
  buildModelDriftFindings,
  buildTelemetryAnomalies,
  buildDataExposureFindings,
  buildSystemTelemetrySummaries,
  summarizeDataExposureFindings,
} from "./oversight-telemetry";

test("flags restricted systems with provider-visible telemetry as exposure findings", () => {
  const findings = buildDataExposureFindings(
    [
      {
        id: "bucket-1",
        provider: "openai",
        bucketStart: new Date("2026-04-10T00:00:00Z"),
        bucketEnd: new Date("2026-04-11T00:00:00Z"),
        granularity: "day",
        dimensionKey: "one",
        model: "gpt-5",
        projectName: "restricted-payroll-assistant",
        projectExternalId: "proj_123",
        actorName: null,
        actorExternalId: null,
        apiKeyName: "prod-payroll",
        apiKeyExternalId: "key_123",
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        requestCount: 4,
        metadata: { classification: "restricted", contains_pii: true },
        syncRunId: "sync-1",
        aiSystemId: "sys-1",
        createdAt: new Date("2026-04-10T01:00:00Z"),
        aiSystem: {
          id: "sys-1",
          name: "Payroll Copilot",
          dataSensitivity: "RESTRICTED",
        },
      },
    ],
    new Map([["openai:2026-04-10T00:00:00.000Z:2026-04-11T00:00:00.000Z:day:one", 9.5]])
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "critical");
  assert.match(findings[0]?.reasons.join(" "), /restricted data/i);
  assert.equal(findings[0]?.visibilitySignals.includes("provider project telemetry"), true);
});

test("flags unattributed telemetry when metadata suggests sensitive categories", () => {
  const findings = buildDataExposureFindings(
    [
      {
        id: "bucket-2",
        provider: "anthropic",
        bucketStart: new Date("2026-04-11T00:00:00Z"),
        bucketEnd: new Date("2026-04-12T00:00:00Z"),
        granularity: "day",
        dimensionKey: "two",
        model: "claude-sonnet-4",
        projectName: null,
        projectExternalId: "phi-review",
        actorName: "Clinical Ops",
        actorExternalId: "user-1",
        apiKeyName: null,
        apiKeyExternalId: null,
        inputTokens: 40,
        outputTokens: 10,
        totalTokens: 50,
        requestCount: 2,
        metadata: { custom_tags: ["patient-triage", "hipaa-review"] },
        syncRunId: "sync-2",
        aiSystemId: null,
        createdAt: new Date("2026-04-11T01:00:00Z"),
        aiSystem: null,
      },
    ],
    new Map()
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "warning");
  assert.equal(findings[0]?.matchedIndicators.includes("PHI"), true);
});

test("summarizes exposure findings for oversight stat cards", () => {
  const summary = summarizeDataExposureFindings([
    {
      id: "one",
      date: new Date("2026-04-10T00:00:00Z"),
      provider: "openai",
      model: "gpt-5",
      attribution: "Payroll Copilot",
      systemName: "Payroll Copilot",
      systemSensitivity: "RESTRICTED",
      severity: "critical",
      score: 7,
      tokens: 100,
      requests: 2,
      cost: 1.2,
      reasons: ["Linked system is classified as restricted data."],
      matchedIndicators: ["Restricted"],
      visibilitySignals: ["provider metadata"],
    },
    {
      id: "two",
      date: new Date("2026-04-11T00:00:00Z"),
      provider: "anthropic",
      model: "claude-sonnet-4",
      attribution: "Clinical Ops",
      systemName: null,
      systemSensitivity: null,
      severity: "warning",
      score: 4,
      tokens: 40,
      requests: 1,
      cost: 0,
      reasons: ["Provider-visible labels or metadata suggest restricted-data handling."],
      matchedIndicators: ["PHI"],
      visibilitySignals: ["provider actor telemetry"],
    },
  ]);

  assert.deepEqual(summary, {
    totalFindings: 2,
    criticalFindings: 1,
    restrictedSystemFindings: 1,
    monitoredSystems: 1,
  });
});

test("builds per-system telemetry summaries for governed systems", () => {
  const summaries = buildSystemTelemetrySummaries(
    [
      {
        id: "bucket-1",
        provider: "openai",
        bucketStart: new Date("2026-04-10T00:00:00Z"),
        bucketEnd: new Date("2026-04-11T00:00:00Z"),
        granularity: "day",
        dimensionKey: "one",
        model: "gpt-5",
        projectName: "payroll-assistant",
        projectExternalId: "proj_123",
        actorName: null,
        actorExternalId: null,
        apiKeyName: null,
        apiKeyExternalId: null,
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
        requestCount: 4,
        metadata: null,
        syncRunId: "sync-1",
        aiSystemId: "sys-1",
        createdAt: new Date("2026-04-10T01:00:00Z"),
        aiSystem: {
          id: "sys-1",
          name: "Payroll Copilot",
          department: "Finance",
          status: "DEPLOYED",
          riskLevel: "HIGH",
          dataSensitivity: "RESTRICTED",
        },
      },
      {
        id: "bucket-2",
        provider: "anthropic",
        bucketStart: new Date("2026-04-11T00:00:00Z"),
        bucketEnd: new Date("2026-04-12T00:00:00Z"),
        granularity: "day",
        dimensionKey: "two",
        model: "claude-sonnet-4",
        projectName: "payroll-assistant",
        projectExternalId: "proj_123",
        actorName: null,
        actorExternalId: null,
        apiKeyName: null,
        apiKeyExternalId: null,
        inputTokens: 80,
        outputTokens: 20,
        totalTokens: 100,
        requestCount: 2,
        metadata: null,
        syncRunId: "sync-2",
        aiSystemId: "sys-1",
        createdAt: new Date("2026-04-11T01:00:00Z"),
        aiSystem: {
          id: "sys-1",
          name: "Payroll Copilot",
          department: "Finance",
          status: "DEPLOYED",
          riskLevel: "HIGH",
          dataSensitivity: "RESTRICTED",
        },
      },
    ],
    new Map([
      ["openai:2026-04-10T00:00:00.000Z:2026-04-11T00:00:00.000Z:day:one", 5],
      ["anthropic:2026-04-11T00:00:00.000Z:2026-04-12T00:00:00.000Z:day:two", 3],
    ])
  );

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0]?.systemName, "Payroll Copilot");
  assert.equal(summaries[0]?.providerCount, 2);
  assert.equal(summaries[0]?.bucketCount, 2);
  assert.equal(summaries[0]?.tokens, 250);
  assert.equal(summaries[0]?.cost, 8);
});

test("detects provider, model, and project telemetry anomalies against a prior baseline", () => {
  const anomalies = buildTelemetryAnomalies(
    [
      {
        id: "baseline-openai",
        provider: "openai",
        bucketStart: new Date("2026-04-01T00:00:00Z"),
        bucketEnd: new Date("2026-04-02T00:00:00Z"),
        granularity: "day",
        dimensionKey: "one",
        model: "gpt-4o",
        projectName: "support-agent",
        projectExternalId: "proj_support",
        actorName: null,
        actorExternalId: null,
        apiKeyName: null,
        apiKeyExternalId: null,
        inputTokens: 400,
        outputTokens: 100,
        totalTokens: 500,
        requestCount: 5,
        metadata: null,
        syncRunId: "sync-1",
        aiSystemId: null,
        createdAt: new Date("2026-04-01T01:00:00Z"),
      },
      {
        id: "recent-openai",
        provider: "openai",
        bucketStart: new Date("2026-04-10T00:00:00Z"),
        bucketEnd: new Date("2026-04-11T00:00:00Z"),
        granularity: "day",
        dimensionKey: "two",
        model: "gpt-4o",
        projectName: "support-agent",
        projectExternalId: "proj_support",
        actorName: null,
        actorExternalId: null,
        apiKeyName: null,
        apiKeyExternalId: null,
        inputTokens: 3800,
        outputTokens: 1200,
        totalTokens: 5000,
        requestCount: 40,
        metadata: null,
        syncRunId: "sync-2",
        aiSystemId: null,
        createdAt: new Date("2026-04-10T01:00:00Z"),
      },
    ],
    new Map([
      ["openai:2026-04-01T00:00:00.000Z:2026-04-02T00:00:00.000Z:day:one", 2],
      ["openai:2026-04-10T00:00:00.000Z:2026-04-11T00:00:00.000Z:day:two", 16],
    ]),
    { now: new Date("2026-04-12T00:00:00Z") }
  );

  assert.equal(anomalies.some((anomaly) => anomaly.scope === "provider"), true);
  assert.equal(anomalies.some((anomaly) => anomaly.scope === "model"), true);
  assert.equal(anomalies.some((anomaly) => anomaly.scope === "project"), true);
});

test("detects governed-system model drift from expected vendor and model family", () => {
  const findings = buildModelDriftFindings(
    [
      {
        id: "bucket-drift",
        provider: "anthropic",
        bucketStart: new Date("2026-04-11T00:00:00Z"),
        bucketEnd: new Date("2026-04-12T00:00:00Z"),
        granularity: "day",
        dimensionKey: "drift",
        model: "claude-sonnet-4",
        projectName: "payroll-assistant",
        projectExternalId: "proj_payroll",
        actorName: null,
        actorExternalId: null,
        apiKeyName: null,
        apiKeyExternalId: null,
        inputTokens: 200,
        outputTokens: 50,
        totalTokens: 250,
        requestCount: 3,
        metadata: null,
        syncRunId: "sync-3",
        aiSystemId: "sys-1",
        createdAt: new Date("2026-04-11T01:00:00Z"),
        aiSystem: {
          id: "sys-1",
          name: "Payroll Copilot",
          vendor: "OpenAI",
          modelType: "gpt-4o",
          department: "Finance",
          status: "DEPLOYED",
          riskLevel: "HIGH",
          dataSensitivity: "RESTRICTED",
        },
      },
    ],
    new Map([
      ["anthropic:2026-04-11T00:00:00.000Z:2026-04-12T00:00:00.000Z:day:drift", 4],
    ])
  );

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "critical");
  assert.match(findings[0]?.reasons.join(" "), /dominant provider/i);
  assert.match(findings[0]?.reasons.join(" "), /dominant model/i);
});

test("does not flag model drift when modelType is a broad category like LLM", () => {
  const findings = buildModelDriftFindings(
    [
      {
        id: "bucket-llm",
        provider: "anthropic",
        bucketStart: new Date("2026-04-11T00:00:00Z"),
        bucketEnd: new Date("2026-04-12T00:00:00Z"),
        granularity: "day",
        dimensionKey: "llm-check",
        model: "claude-sonnet-4-6",
        projectName: null,
        projectExternalId: null,
        actorName: null,
        actorExternalId: null,
        apiKeyName: null,
        apiKeyExternalId: null,
        inputTokens: 500,
        outputTokens: 100,
        totalTokens: 600,
        requestCount: 5,
        metadata: null,
        syncRunId: "sync-4",
        aiSystemId: "sys-llm",
        createdAt: new Date("2026-04-11T01:00:00Z"),
        aiSystem: {
          id: "sys-llm",
          name: "Claude Internal",
          vendor: "Anthropic",
          modelType: "LLM",
          department: "Engineering",
          status: "DEPLOYED",
          riskLevel: "MEDIUM",
          dataSensitivity: "INTERNAL",
        },
      },
    ],
    new Map()
  );

  // An Anthropic system registered as "LLM" using claude-sonnet-4-6 is
  // working as intended — no drift should be reported.
  assert.equal(findings.length, 0);
});

test("still flags vendor drift even when modelType is a broad category", () => {
  const findings = buildModelDriftFindings(
    [
      {
        id: "bucket-vendor-drift",
        provider: "openai",
        bucketStart: new Date("2026-04-11T00:00:00Z"),
        bucketEnd: new Date("2026-04-12T00:00:00Z"),
        granularity: "day",
        dimensionKey: "vendor-drift",
        model: "gpt-4o",
        projectName: null,
        projectExternalId: null,
        actorName: null,
        actorExternalId: null,
        apiKeyName: null,
        apiKeyExternalId: null,
        inputTokens: 300,
        outputTokens: 80,
        totalTokens: 380,
        requestCount: 4,
        metadata: null,
        syncRunId: "sync-5",
        aiSystemId: "sys-vendor",
        createdAt: new Date("2026-04-11T01:00:00Z"),
        aiSystem: {
          id: "sys-vendor",
          name: "Claude Internal",
          vendor: "Anthropic",
          modelType: "LLM",
          department: "Engineering",
          status: "DEPLOYED",
          riskLevel: "HIGH",
          dataSensitivity: "INTERNAL",
        },
      },
    ],
    new Map()
  );

  // Vendor is Anthropic but usage is from OpenAI — should flag vendor drift
  // even though modelType "LLM" is a broad category.
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "critical");
  assert.match(findings[0]?.reasons.join(" "), /dominant provider/i);
  // Should NOT also flag model drift since "LLM" is broad.
  assert.equal(findings[0]?.reasons.join(" ").match(/model family/i), null);
});
