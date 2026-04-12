import test from "node:test";
import assert from "node:assert/strict";
import {
  getRecommendedRiskTier,
  getRiskControlGaps,
  getRiskReassessmentDrift,
  type RiskScores,
} from "./risk-center";

const baselineScores: RiskScores = {
  biasScore: 52,
  securityScore: 78,
  privacyScore: 74,
  fairnessScore: 44,
  performanceScore: 48,
  transparencyScore: 58,
};

test("recommended risk tier escalates for sensitive, user-impacting systems", () => {
  const summary = getRecommendedRiskTier({
    system: {
      id: "sys_1",
      name: "Hiring Copilot",
      department: "HR",
      vendor: "OpenAI",
      modelType: "gpt-4.1",
      useCase: "Customer and employee hiring workflow copilot",
      dataSensitivity: "RESTRICTED",
    },
    scores: baselineScores,
  });

  assert.equal(summary.recommendedRiskLevel, "CRITICAL");
  assert.match(summary.reasons.join(" "), /Restricted data/i);
});

test("control gaps surface missing policy, evidence, and approval work", () => {
  const gaps = getRiskControlGaps({
    system: {
      id: "sys_2",
      name: "Legal Review Assistant",
      department: "Legal",
      dataSensitivity: "CONFIDENTIAL",
      reviewIntervalDays: 365,
    },
    scores: baselineScores,
    policyAssignments: [],
    evidenceArtifactCount: 0,
    requiredStages: ["OWNER", "SECURITY", "COMPLIANCE"],
    approvedStages: ["OWNER"],
    latestApprovalDecision: null,
    openIncidentCount: 1,
  });

  assert.equal(gaps.some((gap) => gap.key === "policy-missing"), true);
  assert.equal(gaps.some((gap) => gap.key === "evidence-missing"), true);
  assert.equal(gaps.some((gap) => gap.key === "stage-signoff"), true);
  assert.equal(gaps.some((gap) => gap.key === "open-incidents"), true);
});

test("risk drift recommends reassessment for scope changes on assessed systems", () => {
  const drift = getRiskReassessmentDrift({
    before: {
      vendor: "OpenAI",
      modelType: "gpt-4.1",
      dataSensitivity: "INTERNAL",
      useCase: "Internal drafting assistant",
      dataInputs: "Internal policy notes",
    },
    after: {
      vendor: "OpenAI",
      modelType: "gpt-4.1",
      dataSensitivity: "CONFIDENTIAL",
      useCase: "Customer support assistant",
      dataInputs: "Customer conversations and account data",
    },
    hasAssessments: true,
  });

  assert.equal(drift.requiresReassessment, true);
  assert.equal(drift.severity, "HIGH");
  assert.match(drift.description, /Risk-sensitive fields changed/i);
});
