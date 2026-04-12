import type {
  AISystemStatus,
  ApprovalDecision,
  ComplianceStatus,
  GovernanceReviewStage,
} from "@prisma/client";

export type GovernanceAction = {
  label: string;
  href: string;
  tone: "critical" | "warning" | "success" | "info";
};

export type SystemWorkflowSummary = {
  stage: string;
  readiness: "blocked" | "in_progress" | "ready" | "monitored";
  message: string;
  actions: GovernanceAction[];
};

type Input = {
  id: string;
  status: AISystemStatus;
  riskAssessmentsCount: number;
  policyAssignmentsCount: number;
  notAssessedAssignments: number;
  nonCompliantAssignments: number;
  partialAssignments: number;
  latestApprovalDecision?: ApprovalDecision | null;
  nextReviewDate?: Date | string | null;
  activeExceptionCount: number;
  requiredStages: GovernanceReviewStage[];
  approvedStages: GovernanceReviewStage[];
};

export const GOVERNANCE_STAGE_LABELS: Record<GovernanceReviewStage, string> = {
  OWNER: "Owner",
  SECURITY: "Security",
  LEGAL: "Legal",
  COMPLIANCE: "Compliance",
};

export function getSystemWorkflowSummary(input: Input): SystemWorkflowSummary {
  const actions: GovernanceAction[] = [];
  const missingStages = input.requiredStages.filter((stage) => !input.approvedStages.includes(stage));
  const reviewOverdue =
    !!input.nextReviewDate && new Date(input.nextReviewDate).getTime() < Date.now();
  const governanceReady =
    input.riskAssessmentsCount > 0 &&
    input.policyAssignmentsCount > 0 &&
    input.notAssessedAssignments === 0 &&
    input.nonCompliantAssignments === 0 &&
    input.partialAssignments === 0 &&
    missingStages.length === 0 &&
    !reviewOverdue;

  if (input.riskAssessmentsCount === 0) {
    actions.push({
      label: "Run initial risk assessment",
      href: `/risk-center/assessments/new?systemId=${input.id}`,
      tone: "warning",
    });
  }

  if (input.policyAssignmentsCount === 0) {
    actions.push({
      label: "Assign governing policy",
      href: `/registry/${input.id}?tab=compliance`,
      tone: "warning",
    });
  }

  if (input.notAssessedAssignments > 0 || input.partialAssignments > 0 || input.nonCompliantAssignments > 0) {
    actions.push({
      label: "Update compliance evidence",
      href: `/registry/${input.id}?tab=compliance`,
      tone: input.nonCompliantAssignments > 0 ? "critical" : "warning",
    });
  }

  if (missingStages.length > 0) {
    actions.push({
      label: `Complete ${missingStages.map((stage) => GOVERNANCE_STAGE_LABELS[stage]).join(", ")} review`,
      href: `/registry/${input.id}`,
      tone: "warning",
    });
  }

  if (reviewOverdue) {
    actions.push({
      label: "Renew governance review cadence",
      href: `/registry/${input.id}`,
      tone: "critical",
    });
  }

  if (input.activeExceptionCount > 0) {
    actions.push({
      label: "Review active governance exceptions",
      href: `/registry/${input.id}`,
      tone: "info",
    });
  }

  if (input.latestApprovalDecision === "CHANGES_REQUESTED") {
    actions.push({
      label: "Address requested changes",
      href: `/registry/${input.id}`,
      tone: "critical",
    });
  }

  if (input.latestApprovalDecision === "REVOKED") {
    actions.push({
      label: "Re-open approval review",
      href: `/registry/${input.id}`,
      tone: "critical",
    });
  }

  if (
    governanceReady &&
    input.latestApprovalDecision !== "APPROVED"
  ) {
    actions.push({
      label: "Record approval decision",
      href: `/registry/${input.id}`,
      tone: "success",
    });
  }

  if (
    actions.length === 0 &&
    input.latestApprovalDecision === "APPROVED" &&
    (input.status === "APPROVED" || input.status === "DEPLOYED")
  ) {
    return {
      stage: "Monitored",
      readiness: "monitored",
      message: "This system has baseline governance coverage and is in ongoing monitoring.",
      actions: [
        {
          label: "Review telemetry and alerts",
          href: "/oversight",
          tone: "info",
        },
      ],
    };
  }

  if (input.latestApprovalDecision === "CHANGES_REQUESTED") {
    return {
      stage: "Changes Requested",
      readiness: "blocked",
      message: "Approval review identified follow-up work before this system can move into approved monitoring.",
      actions,
    };
  }

  if (input.latestApprovalDecision === "REVOKED") {
    return {
      stage: "Approval Revoked",
      readiness: "blocked",
      message: "This system was previously approved, but the approval was revoked and should be re-reviewed before continued deployment.",
      actions,
    };
  }

  if (input.nonCompliantAssignments > 0) {
    return {
      stage: "Blocked",
      readiness: "blocked",
      message: "This system has open compliance blockers that should be resolved before approval or continued deployment.",
      actions,
    };
  }

  if (reviewOverdue) {
    return {
      stage: "Review Overdue",
      readiness: "blocked",
      message: "This system has passed its scheduled governance review date and should be re-reviewed before continued approval.",
      actions,
    };
  }

  if (governanceReady) {
    return {
      stage: input.status === "UNDER_REVIEW" ? "Approval Review" : "Ready",
      readiness: "ready",
      message:
        input.latestApprovalDecision === "APPROVED"
          ? "Core governance steps are complete and the system has an approval record."
          : "Core governance steps are complete and the system can move through formal approval review.",
      actions,
    };
  }

  return {
    stage: input.status === "DRAFT" ? "Intake" : "In Progress",
    readiness: "in_progress",
    message:
      missingStages.length > 0
        ? "This system still needs required stage approvals before it can complete formal governance review."
        : "This system still needs governance work before it is fully approved and monitored.",
    actions,
  };
}

export function complianceTone(status: ComplianceStatus): "critical" | "warning" | "success" | "info" {
  if (status === "NON_COMPLIANT") return "critical";
  if (status === "PARTIALLY_COMPLIANT" || status === "NOT_ASSESSED") return "warning";
  return "success";
}
