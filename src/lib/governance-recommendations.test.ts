import test from "node:test";
import assert from "node:assert/strict";
import { getSystemGovernanceRecommendations } from "./governance-recommendations";

test("prioritizes open incidents ahead of other recommendations", () => {
  const summary = getSystemGovernanceRecommendations({
    id: "sys_1",
    status: "UNDER_REVIEW",
    riskLevel: "HIGH",
    vendor: "OpenAI",
    department: "Engineering",
    modelType: "gpt-4.1",
    dataSensitivity: "INTERNAL",
    reviewIntervalDays: 90,
    nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
    requireOwnerApproval: true,
    requireSecurityApproval: true,
    requireLegalApproval: false,
    requireComplianceApproval: true,
    riskAssessmentsCount: 1,
    latestApprovalDecision: null,
    policyAssignments: [],
    governanceReviews: [],
    governanceExceptions: [],
    governanceIncidents: [
      {
        id: "inc_1",
        title: "Prompt leakage event",
        status: "OPEN",
      },
    ],
  });

  assert.equal(summary.primary?.source, "incident");
  assert.match(summary.primary?.title ?? "", /incident/i);
});

test("surfaces blocking policy-rule fixes as next-best actions", () => {
  const summary = getSystemGovernanceRecommendations({
    id: "sys_2",
    status: "UNDER_REVIEW",
    riskLevel: "MEDIUM",
    vendor: "OpenAI",
    department: "Engineering",
    modelType: "gpt-4.1",
    dataSensitivity: "INTERNAL",
    reviewIntervalDays: 90,
    nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
    requireOwnerApproval: true,
    requireSecurityApproval: true,
    requireLegalApproval: false,
    requireComplianceApproval: true,
    riskAssessmentsCount: 1,
    latestApprovalDecision: null,
    policyAssignments: [
      {
        id: "pa_1",
        complianceStatus: "COMPLIANT",
        policy: {
          id: "pol_1",
          name: "Approved Vendors",
          rules: {
            blockedVendors: ["OpenAI"],
            actions: { enforcement: "BLOCK" },
          },
        },
      },
    ],
    governanceReviews: [
      { stage: "OWNER", approved: true },
      { stage: "SECURITY", approved: true },
      { stage: "COMPLIANCE", approved: true },
    ],
    governanceExceptions: [],
    governanceIncidents: [],
  });

  assert.equal(summary.primary?.source, "policy");
  assert.match(summary.primary?.title ?? "", /policy blockers/i);
});

test("returns approval recommendation for governance-ready systems", () => {
  const summary = getSystemGovernanceRecommendations({
    id: "sys_3",
    status: "UNDER_REVIEW",
    riskLevel: "MEDIUM",
    vendor: "Anthropic",
    department: "Legal",
    modelType: "claude-sonnet",
    dataSensitivity: "CONFIDENTIAL",
    reviewIntervalDays: 90,
    nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
    requireOwnerApproval: true,
    requireSecurityApproval: true,
    requireLegalApproval: false,
    requireComplianceApproval: true,
    riskAssessmentsCount: 1,
    latestApprovalDecision: null,
    policyAssignments: [
      {
        id: "pa_2",
        complianceStatus: "COMPLIANT",
        policy: {
          id: "pol_2",
          name: "Baseline Governance",
          rules: null,
        },
      },
    ],
    governanceReviews: [
      { stage: "OWNER", approved: true },
      { stage: "SECURITY", approved: true },
      { stage: "COMPLIANCE", approved: true },
    ],
    governanceExceptions: [],
    governanceIncidents: [],
  });

  assert.equal(summary.primary?.tone, "success");
  assert.match(summary.primary?.title ?? "", /approval decision/i);
});
