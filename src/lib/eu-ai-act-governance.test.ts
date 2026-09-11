import { test } from "node:test";
import assert from "node:assert/strict";
import { getApprovalBlockers, isHardBlocker } from "./approval-blockers";
import { getSystemGovernanceRecommendations } from "./governance-recommendations";
import { buildEuAiActGovernanceInput } from "./eu-ai-act-data";
import type { SystemFrameworkCoverage } from "./framework-coverage";

const baseBlockerInput = {
  systemId: "sys-1",
  riskAssessmentsCount: 1,
  policyAssignments: [],
  requiredStages: [],
  approvedStages: new Set<never>(),
  nextReviewDate: new Date(Date.now() + 86_400_000),
};

test("blockers are unchanged when euAiAct is not supplied", () => {
  const blockers = getApprovalBlockers(baseBlockerInput);
  assert.equal(blockers.some((b) => b.category.startsWith("eu_ai_act")), false);
});

test("unclassified system gets a soft classification blocker linking to the wizard", () => {
  const blockers = getApprovalBlockers({
    ...baseBlockerInput,
    euAiAct: { classified: false, tier: null, unassessedObligations: 0, applicableArticles: 0 },
  });
  const eu = blockers.find((b) => b.category === "eu_ai_act_classification");
  assert.ok(eu);
  assert.equal(eu.href, "/registry/sys-1/eu-ai-act");
  assert.equal(isHardBlocker(eu), false);
});

test("prohibited tier is a hard blocker", () => {
  const blockers = getApprovalBlockers({
    ...baseBlockerInput,
    euAiAct: { classified: true, tier: "PROHIBITED", unassessedObligations: 0, applicableArticles: 2 },
  });
  const eu = blockers.find((b) => b.category === "eu_ai_act_prohibited");
  assert.ok(eu);
  assert.equal(isHardBlocker(eu), true);
});

test("high-risk with unassessed articles is a soft obligation blocker; fully assessed is silent", () => {
  const open = getApprovalBlockers({
    ...baseBlockerInput,
    euAiAct: { classified: true, tier: "HIGH_RISK", unassessedObligations: 3, applicableArticles: 6 },
  });
  const eu = open.find((b) => b.category === "eu_ai_act_obligation");
  assert.ok(eu);
  assert.match(eu.message, /3 of 6/);
  assert.equal(isHardBlocker(eu), false);
  assert.equal(eu.href, "/registry/sys-1?tab=compliance&framework=EU_AI_ACT");

  const done = getApprovalBlockers({
    ...baseBlockerInput,
    euAiAct: { classified: true, tier: "HIGH_RISK", unassessedObligations: 0, applicableArticles: 6 },
  });
  assert.equal(done.some((b) => b.category.startsWith("eu_ai_act")), false);

  const minimal = getApprovalBlockers({
    ...baseBlockerInput,
    euAiAct: { classified: true, tier: "MINIMAL_RISK", unassessedObligations: 1, applicableArticles: 1 },
  });
  assert.equal(minimal.some((b) => b.category.startsWith("eu_ai_act")), false);
});

const baseRecInput = {
  id: "sys-1",
  status: "UNDER_REVIEW" as const,
  riskLevel: "MEDIUM" as const,
  vendor: null,
  department: "Ops",
  modelType: null,
  dataSensitivity: "INTERNAL" as const,
  reviewIntervalDays: 365,
  nextReviewDate: new Date(Date.now() + 86_400_000),
  requireOwnerApproval: false,
  requireSecurityApproval: false,
  requireLegalApproval: false,
  requireComplianceApproval: false,
  riskAssessmentsCount: 1,
  latestApprovalDecision: null,
  policyAssignments: [],
  governanceReviews: [],
  governanceExceptions: [],
  governanceIncidents: [],
};

test("recommendations surface the EU AI Act state with the expected priorities", () => {
  const unclassified = getSystemGovernanceRecommendations({
    ...baseRecInput,
    euAiAct: { classified: false, tier: null, unassessedObligations: 0, applicableArticles: 0 },
  });
  const rec = unclassified.recommendations.find((r) => r.key === "eu-ai-act-unclassified");
  assert.ok(rec);
  assert.equal(rec.priority, 80);
  assert.equal(rec.source, "regulatory");

  const prohibited = getSystemGovernanceRecommendations({
    ...baseRecInput,
    euAiAct: { classified: true, tier: "PROHIBITED", unassessedObligations: 0, applicableArticles: 2 },
  });
  assert.equal(prohibited.primary?.key, "eu-ai-act-prohibited");
  assert.equal(prohibited.primary?.tone, "critical");

  const highRisk = getSystemGovernanceRecommendations({
    ...baseRecInput,
    euAiAct: { classified: true, tier: "HIGH_RISK", unassessedObligations: 2, applicableArticles: 6 },
  });
  assert.ok(highRisk.recommendations.some((r) => r.key === "eu-ai-act-obligations" && r.priority === 84));

  const none = getSystemGovernanceRecommendations(baseRecInput);
  assert.equal(none.recommendations.some((r) => r.source === "regulatory"), false);
});

test("buildEuAiActGovernanceInput counts only applicable articles that are NOT_ASSESSED", () => {
  const control = (code: string) => ({
    id: code,
    framework: "EU_AI_ACT" as const,
    code,
    title: code,
    category: "x",
    sortOrder: 1,
  });
  const row = (code: string, status: "COMPLIANT" | "INHERITED" | "NOT_ASSESSED" | "PARTIALLY_COMPLIANT") => ({
    control: control(code),
    status,
    source: "direct" as const,
    mappingId: null,
    evidence: null,
    assessedAt: null,
    crosswalk: [],
    inheritedFrom: [],
  });
  const coverage: SystemFrameworkCoverage = {
    framework: "EU_AI_ACT",
    rows: [row("Art. 4", "COMPLIANT"), row("Art. 26", "NOT_ASSESSED"), row("Art. 27", "PARTIALLY_COMPLIANT"), row("Art. 9", "NOT_ASSESSED")],
    summary: { total: 4, compliant: 1, inherited: 0, partiallyCompliant: 1, nonCompliant: 0, notAssessed: 2, coveragePct: 25, assessedPct: 50 },
  };
  const input = buildEuAiActGovernanceInput(
    { tier: "HIGH_RISK", applicableArticles: ["Art. 4", "Art. 26", "Art. 27"] },
    coverage
  );
  // Art. 9 is NOT_ASSESSED but not applicable, so it is not counted.
  assert.deepEqual(input, { classified: true, tier: "HIGH_RISK", unassessedObligations: 1, applicableArticles: 3 });
  assert.equal(buildEuAiActGovernanceInput(null, coverage).classified, false);
});
