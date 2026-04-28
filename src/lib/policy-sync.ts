/**
 * Deterministic policy-assignment compliance sync.
 *
 * Runs `evaluatePolicyRules` against the policy's JSON rules and the current
 * AISystem state, then writes the result to `PolicyAssignment.complianceStatus`
 * and replaces deterministic `ComplianceIssue` rows (source: "rule_eval").
 *
 * Issues from the AI assessment flow (source: "ai_assessment") are left alone —
 * the two layers coexist. Last writer wins on status; neither clobbers the
 * other's issue rows.
 *
 * Call sites: policy create/update, assignment upsert, AI system update.
 * Never called on a hot path (all behind admin routes), so no batching.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { evaluatePolicyRules, parsePolicyRules } from "./policy-rules";

const RULE_EVAL_SOURCE = "rule_eval";

type SyncSummary = {
  assignmentId: string;
  compliant: boolean;
  complianceStatus: string;
  blockingCount: number;
  advisoryCount: number;
};

/**
 * Re-evaluate a single PolicyAssignment and persist the deterministic result.
 * No-op if the assignment, policy, or system has disappeared.
 */
export async function syncAssignment(
  assignmentId: string,
  tx: Prisma.TransactionClient | typeof prisma = prisma
): Promise<SyncSummary | null> {
  const assignment = await tx.policyAssignment.findUnique({
    where: { id: assignmentId },
    include: {
      policy: { select: { rules: true } },
      aiSystem: {
        select: {
          vendor: true,
          department: true,
          status: true,
          modelType: true,
          dataSensitivity: true,
          reviewIntervalDays: true,
          riskLevel: true,
          requireOwnerApproval: true,
          requireSecurityApproval: true,
          requireLegalApproval: true,
          requireComplianceApproval: true,
          governanceExceptions: {
            where: { status: "ACTIVE" },
            select: { expiresAt: true },
          },
        },
      },
    },
  });

  if (!assignment) return null;

  const system = assignment.aiSystem;
  const activeExceptionCount = system.governanceExceptions.filter(
    (exception) => new Date(exception.expiresAt).getTime() >= Date.now()
  ).length;

  const rules = parsePolicyRules(assignment.policy.rules);
  const evaluation = evaluatePolicyRules(rules, {
    vendor: system.vendor,
    department: system.department,
    status: system.status,
    modelType: system.modelType,
    dataSensitivity: system.dataSensitivity,
    reviewIntervalDays: system.reviewIntervalDays,
    riskLevel: system.riskLevel,
    requireOwnerApproval: system.requireOwnerApproval,
    requireSecurityApproval: system.requireSecurityApproval,
    requireLegalApproval: system.requireLegalApproval,
    requireComplianceApproval: system.requireComplianceApproval,
    activeExceptionCount,
  });

  // Replace deterministic issues only; AI-sourced issues are preserved.
  await tx.complianceIssue.deleteMany({
    where: { policyAssignmentId: assignment.id, source: RULE_EVAL_SOURCE },
  });

  if (evaluation.blockingViolations.length || evaluation.advisories.length) {
    const issues = [
      ...evaluation.blockingViolations.map((message) => ({
        severity: "HIGH" as const,
        message,
      })),
      ...evaluation.advisories.map((message) => ({
        severity: "MEDIUM" as const,
        message,
      })),
    ];

    await tx.complianceIssue.createMany({
      data: issues.map((issue, index) => ({
        policyAssignmentId: assignment.id,
        requirement: "rule_eval",
        title: `Policy rule violation ${index + 1}`,
        detail: issue.message,
        // Recommendations are aggregated at the evaluation level, not per-issue.
        // The detail message carries the full violation text.
        severity: issue.severity,
        status: "OPEN" as const,
        source: RULE_EVAL_SOURCE,
      })),
    });
  }

  await tx.policyAssignment.update({
    where: { id: assignment.id },
    data: {
      complianceStatus: evaluation.recommendedComplianceStatus,
      assessedAt: new Date(),
    },
  });

  return {
    assignmentId: assignment.id,
    compliant: evaluation.compliant,
    complianceStatus: evaluation.recommendedComplianceStatus,
    blockingCount: evaluation.blockingViolations.length,
    advisoryCount: evaluation.advisories.length,
  };
}

/** Fan out to every assignment of a given policy. */
export async function syncAssignmentsForPolicy(
  policyId: string
): Promise<SyncSummary[]> {
  const assignments = await prisma.policyAssignment.findMany({
    where: { policyId },
    select: { id: true },
  });

  const results: SyncSummary[] = [];
  for (const { id } of assignments) {
    const summary = await syncAssignment(id);
    if (summary) results.push(summary);
  }
  return results;
}

/** Fan out to every assignment attached to a given AI system. */
export async function syncAssignmentsForSystem(
  aiSystemId: string
): Promise<SyncSummary[]> {
  const assignments = await prisma.policyAssignment.findMany({
    where: { aiSystemId },
    select: { id: true },
  });

  const results: SyncSummary[] = [];
  for (const { id } of assignments) {
    const summary = await syncAssignment(id);
    if (summary) results.push(summary);
  }
  return results;
}
