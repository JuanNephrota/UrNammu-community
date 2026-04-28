import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGovernanceAutomation } from "./governance-automation";

test("flags review renewals, exception renewals, and blocked ownership escalations", () => {
  const result = evaluateGovernanceAutomation({
    now: new Date("2026-04-12T00:00:00Z"),
    reviewNoticeDays: 14,
    exceptionNoticeDays: 14,
    escalationOverdueDays: 7,
    systems: [
      {
        id: "sys-1",
        name: "Payroll Copilot",
        ownerName: "Pat",
        ownerEmail: "pat@example.com",
        status: "UNDER_REVIEW",
        nextReviewDate: new Date("2026-04-20T00:00:00Z"),
        riskAssessmentsCount: 1,
        policyAssignmentsCount: 1,
        notAssessedAssignments: 0,
        nonCompliantAssignments: 0,
        partialAssignments: 0,
        latestApprovalDecision: "CHANGES_REQUESTED",
        activeExceptionCount: 0,
        requiredStages: ["OWNER", "SECURITY", "COMPLIANCE"],
        approvedStages: ["OWNER"],
      },
      {
        id: "sys-2",
        name: "Claims Assistant",
        ownerName: "Jordan",
        ownerEmail: "jordan@example.com",
        status: "APPROVED",
        nextReviewDate: new Date("2026-03-20T00:00:00Z"),
        riskAssessmentsCount: 1,
        policyAssignmentsCount: 1,
        notAssessedAssignments: 0,
        nonCompliantAssignments: 0,
        partialAssignments: 0,
        latestApprovalDecision: "APPROVED",
        activeExceptionCount: 0,
        requiredStages: ["OWNER", "SECURITY", "COMPLIANCE"],
        approvedStages: ["OWNER", "SECURITY", "COMPLIANCE"],
      },
    ],
    exceptions: [
      {
        id: "exc-1",
        aiSystemId: "sys-1",
        systemName: "Payroll Copilot",
        title: "Temporary payroll exception",
        expiresAt: new Date("2026-04-18T00:00:00Z"),
      },
    ],
  });

  assert.equal(result.reviewRenewals.length, 1);
  assert.equal(result.exceptionRenewals.length, 1);
  assert.equal(result.ownershipEscalations.some((item) => item.key === "escalation:blocked:sys-1"), true);
  assert.equal(result.ownershipEscalations.some((item) => item.key === "escalation:overdue:sys-2"), true);
});
