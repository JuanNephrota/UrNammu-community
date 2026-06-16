import test from "node:test";
import assert from "node:assert/strict";
import { getSystemWorkflowSummary } from "./governance-workflow";

test("workflow flags missing assessment and policy assignment", () => {
  const summary = getSystemWorkflowSummary({
    id: "sys_1",
    status: "DRAFT",
    riskAssessmentsCount: 0,
    policyAssignmentsCount: 0,
    notAssessedAssignments: 0,
    nonCompliantAssignments: 0,
    partialAssignments: 0,
    nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
    activeExceptionCount: 0,
    requiredStages: [],
    approvedStages: [],
  });

  assert.equal(summary.readiness, "in_progress");
  assert.equal(summary.actions.length, 2);
  assert.equal(summary.actions[0]?.href, "/risk-center/assessments/new?systemId=sys_1");
});

test("workflow blocks non-compliant systems", () => {
  const summary = getSystemWorkflowSummary({
    id: "sys_2",
    status: "UNDER_REVIEW",
    riskAssessmentsCount: 1,
    policyAssignmentsCount: 1,
    notAssessedAssignments: 0,
    nonCompliantAssignments: 1,
    partialAssignments: 0,
    nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
    activeExceptionCount: 0,
    requiredStages: [],
    approvedStages: [],
  });

  assert.equal(summary.readiness, "blocked");
  assert.match(summary.message, /compliance blockers/i);
});

test("workflow marks governance-complete systems as ready for approval", () => {
  const summary = getSystemWorkflowSummary({
    id: "sys_3",
    status: "UNDER_REVIEW",
    riskAssessmentsCount: 1,
    policyAssignmentsCount: 1,
    notAssessedAssignments: 0,
    nonCompliantAssignments: 0,
    partialAssignments: 0,
    nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
    activeExceptionCount: 0,
    requiredStages: ["OWNER", "SECURITY"],
    approvedStages: ["OWNER", "SECURITY"],
  });

  assert.equal(summary.readiness, "ready");
  assert.equal(summary.actions.some((action) => action.label === "Record approval decision"), true);
});

test("workflow blocks systems with requested approval changes", () => {
  const summary = getSystemWorkflowSummary({
    id: "sys_4",
    status: "UNDER_REVIEW",
    riskAssessmentsCount: 1,
    policyAssignmentsCount: 1,
    notAssessedAssignments: 0,
    nonCompliantAssignments: 0,
    partialAssignments: 0,
    latestApprovalDecision: "CHANGES_REQUESTED",
    nextReviewDate: new Date(Date.now() + 86400000).toISOString(),
    activeExceptionCount: 0,
    requiredStages: [],
    approvedStages: [],
  });

  assert.equal(summary.readiness, "blocked");
  assert.match(summary.message, /follow-up work/i);
});

test("workflow blocks systems with overdue reviews", () => {
  const summary = getSystemWorkflowSummary({
    id: "sys_5",
    status: "APPROVED",
    riskAssessmentsCount: 1,
    policyAssignmentsCount: 1,
    notAssessedAssignments: 0,
    nonCompliantAssignments: 0,
    partialAssignments: 0,
    nextReviewDate: new Date(Date.now() - 86400000).toISOString(),
    activeExceptionCount: 0,
    requiredStages: ["OWNER"],
    approvedStages: ["OWNER"],
  });

  assert.equal(summary.readiness, "blocked");
  assert.match(summary.message, /review date/i);
});
