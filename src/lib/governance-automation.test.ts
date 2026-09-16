import test from "node:test";
import assert from "node:assert/strict";
import { evaluateGovernanceAutomation, evaluateUsageAfterDeactivation } from "./governance-automation";

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

test("usage after deactivation flags activity newer than deactivatedAt, via primary or alias", () => {
  const deactivatedAt = new Date("2026-09-01T00:00:00Z");
  const candidates = evaluateUsageAfterDeactivation({
    people: [
      { primaryEmail: "gone@example.com", aliases: ["g@example.com"], displayName: "Gone Person", source: "google_workspace", deactivatedAt },
      { primaryEmail: "quiet@example.com", aliases: [], source: "microsoft_365", deactivatedAt },
    ],
    activity: [
      { email: "G@example.com", surface: "cursor", lastActiveAt: new Date("2026-09-05T00:00:00Z") },
      { email: "gone@example.com", surface: "proxy", lastActiveAt: new Date("2026-09-03T00:00:00Z") },
      // before deactivation — ignored
      { email: "quiet@example.com", surface: "proxy", lastActiveAt: new Date("2026-08-30T00:00:00Z") },
      // not a directory person — ignored
      { email: "active@example.com", surface: "claude_code", lastActiveAt: new Date("2026-09-10T00:00:00Z") },
      // not an email — ignored
      { email: "user:42", surface: "cursor", lastActiveAt: new Date("2026-09-10T00:00:00Z") },
    ],
  });
  assert.equal(candidates.length, 1);
  const [c] = candidates;
  assert.equal(c.email, "gone@example.com");
  assert.equal(c.key, "usage_after_deactivation:gone@example.com");
  assert.equal(c.severity, "HIGH");
  assert.deepEqual(c.surfaces, ["cursor", "proxy"]);
  assert.equal(c.lastActiveAt.toISOString(), "2026-09-05T00:00:00.000Z");
  assert.match(c.title, /gone@example.com/);
  assert.match(c.description, /Gone Person/);
  assert.match(c.description, /2026-09-01/);
});

test("usage after deactivation returns nothing when no activity postdates deactivation", () => {
  const deactivatedAt = new Date("2026-09-01T00:00:00Z");
  assert.deepEqual(
    evaluateUsageAfterDeactivation({
      people: [{ primaryEmail: "gone@example.com", aliases: [], source: "google_workspace", deactivatedAt }],
      activity: [{ email: "gone@example.com", surface: "proxy", lastActiveAt: deactivatedAt }],
    }),
    []
  );
});
