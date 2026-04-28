import type {
  AISystemStatus,
  ApprovalDecision,
  GovernanceReviewStage,
} from "@prisma/client";
import { getSystemWorkflowSummary } from "./governance-workflow";

type AutomationSystem = {
  id: string;
  name: string;
  ownerName: string | null;
  ownerEmail: string | null;
  status: AISystemStatus;
  nextReviewDate: Date | null;
  riskAssessmentsCount: number;
  policyAssignmentsCount: number;
  notAssessedAssignments: number;
  nonCompliantAssignments: number;
  partialAssignments: number;
  latestApprovalDecision: ApprovalDecision | null;
  activeExceptionCount: number;
  requiredStages: GovernanceReviewStage[];
  approvedStages: GovernanceReviewStage[];
};

type AutomationException = {
  id: string;
  aiSystemId: string;
  systemName: string;
  title: string;
  expiresAt: Date;
};

export type GovernanceAutomationCandidate = {
  key: string;
  aiSystemId: string;
  title: string;
  description: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
};

export function evaluateGovernanceAutomation(input: {
  systems: AutomationSystem[];
  exceptions: AutomationException[];
  now: Date;
  reviewNoticeDays: number;
  exceptionNoticeDays: number;
  escalationOverdueDays: number;
}) {
  const reviewRenewals: GovernanceAutomationCandidate[] = [];
  const exceptionRenewals: GovernanceAutomationCandidate[] = [];
  const ownershipEscalations: GovernanceAutomationCandidate[] = [];

  for (const system of input.systems) {
    const workflow = getSystemWorkflowSummary({
      id: system.id,
      status: system.status,
      riskAssessmentsCount: system.riskAssessmentsCount,
      policyAssignmentsCount: system.policyAssignmentsCount,
      notAssessedAssignments: system.notAssessedAssignments,
      nonCompliantAssignments: system.nonCompliantAssignments,
      partialAssignments: system.partialAssignments,
      latestApprovalDecision: system.latestApprovalDecision,
      nextReviewDate: system.nextReviewDate,
      activeExceptionCount: system.activeExceptionCount,
      requiredStages: system.requiredStages,
      approvedStages: system.approvedStages,
    });

    if (system.nextReviewDate) {
      const daysUntilReview =
        (system.nextReviewDate.getTime() - input.now.getTime()) / 86400000;

      if (daysUntilReview >= 0 && daysUntilReview <= input.reviewNoticeDays) {
        reviewRenewals.push({
          key: `review:${system.id}`,
          aiSystemId: system.id,
          title: `${system.name} review renewal is coming up`,
          description: `Scheduled review falls due on ${system.nextReviewDate.toLocaleDateString("en-US")}.`,
          severity: daysUntilReview <= 3 ? "HIGH" : "MEDIUM",
        });
      }

      if (-daysUntilReview >= input.escalationOverdueDays) {
        ownershipEscalations.push({
          key: `escalation:overdue:${system.id}`,
          aiSystemId: system.id,
          title: `${system.name} needs owner escalation`,
          description: `Review is overdue and should be escalated to ${system.ownerName ?? system.ownerEmail ?? "the assigned owner"}.`,
          severity: "HIGH",
        });
      }
    }

    if (!system.ownerName && !system.ownerEmail) {
      ownershipEscalations.push({
        key: `escalation:owner:${system.id}`,
        aiSystemId: system.id,
        title: `${system.name} is missing an accountable owner`,
        description: "Assign a named owner before the system proceeds through governance review.",
        severity: "HIGH",
      });
    }

    if (workflow.readiness === "blocked") {
      ownershipEscalations.push({
        key: `escalation:blocked:${system.id}`,
        aiSystemId: system.id,
        title: `${system.name} is blocked in governance`,
        description: workflow.message,
        severity: "MEDIUM",
      });
    }
  }

  for (const exception of input.exceptions) {
    const daysUntilExpiration =
      (exception.expiresAt.getTime() - input.now.getTime()) / 86400000;
    if (daysUntilExpiration >= 0 && daysUntilExpiration <= input.exceptionNoticeDays) {
      exceptionRenewals.push({
        key: `exception:${exception.id}`,
        aiSystemId: exception.aiSystemId,
        title: `${exception.systemName} exception expires soon`,
        description: `${exception.title} expires on ${exception.expiresAt.toLocaleDateString("en-US")}.`,
        severity: daysUntilExpiration <= 3 ? "HIGH" : "MEDIUM",
      });
    }
  }

  return {
    reviewRenewals,
    exceptionRenewals,
    ownershipEscalations: ownershipEscalations.filter(
      (candidate, index, all) => all.findIndex((item) => item.key === candidate.key) === index
    ),
  };
}
