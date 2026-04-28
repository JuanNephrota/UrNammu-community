import type {
  AISystemStatus,
  AlertStatus,
  ComplianceStatus,
  GovernanceReviewStage,
  Prisma,
  RiskLevel,
} from "@prisma/client";
import { getSystemWorkflowSummary, GOVERNANCE_STAGE_LABELS } from "@/lib/governance-workflow";
import { evaluatePolicyRules, parsePolicyRules } from "@/lib/policy-rules";

export type GovernanceRecommendationTone = "critical" | "warning" | "success" | "info";

export type GovernanceRecommendation = {
  key: string;
  title: string;
  detail: string;
  href: string;
  tone: GovernanceRecommendationTone;
  source: "workflow" | "policy" | "exception" | "incident" | "monitoring";
  priority: number;
};

type GovernanceRecommendationInput = {
  id: string;
  status: AISystemStatus;
  riskLevel: RiskLevel;
  vendor: string | null;
  department: string;
  modelType: string | null;
  dataSensitivity: "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED";
  reviewIntervalDays: number;
  nextReviewDate: Date | string | null;
  requireOwnerApproval: boolean;
  requireSecurityApproval: boolean;
  requireLegalApproval: boolean;
  requireComplianceApproval: boolean;
  riskAssessmentsCount: number;
  latestApprovalDecision?:
    | "APPROVED"
    | "CHANGES_REQUESTED"
    | "REVOKED"
    | null;
  policyAssignments: Array<{
    id: string;
    complianceStatus: ComplianceStatus;
    policy: {
      id: string;
      name: string;
      rules: Prisma.JsonValue | null;
    };
  }>;
  governanceReviews: Array<{
    stage: GovernanceReviewStage;
    approved: boolean;
  }>;
  governanceExceptions: Array<{
    status: "ACTIVE" | "EXPIRED" | "REVOKED";
    expiresAt: Date | string;
  }>;
  governanceIncidents: Array<{
    id: string;
    title: string;
    status: AlertStatus;
  }>;
  linkedDiscoveriesCount?: number;
};

export type GovernanceRecommendationSummary = {
  workflow: ReturnType<typeof getSystemWorkflowSummary>;
  primary: GovernanceRecommendation | null;
  recommendations: GovernanceRecommendation[];
};

function addRecommendation(
  recommendations: GovernanceRecommendation[],
  recommendation: GovernanceRecommendation
) {
  if (
    recommendations.some(
      (existing) =>
        existing.title === recommendation.title &&
        existing.href === recommendation.href
    )
  ) {
    return;
  }
  recommendations.push(recommendation);
}

export function getRequiredStages(input: {
  requireOwnerApproval: boolean;
  requireSecurityApproval: boolean;
  requireLegalApproval: boolean;
  requireComplianceApproval: boolean;
}) {
  return [
    ...(input.requireOwnerApproval ? (["OWNER"] as const) : []),
    ...(input.requireSecurityApproval ? (["SECURITY"] as const) : []),
    ...(input.requireLegalApproval ? (["LEGAL"] as const) : []),
    ...(input.requireComplianceApproval ? (["COMPLIANCE"] as const) : []),
  ];
}

export function getApprovedStages(
  reviews: Array<{ stage: GovernanceReviewStage; approved: boolean }>
) {
  const latestStageApprovals = new Map<GovernanceReviewStage, boolean>();
  for (const review of reviews) {
    if (!latestStageApprovals.has(review.stage)) {
      latestStageApprovals.set(review.stage, review.approved);
    }
  }

  return Array.from(latestStageApprovals.entries())
    .filter(([, approved]) => approved)
    .map(([stage]) => stage);
}

export function getActiveExceptionCount(
  exceptions: Array<{ status: "ACTIVE" | "EXPIRED" | "REVOKED"; expiresAt: Date | string }>
) {
  const now = Date.now();
  return exceptions.filter(
    (exception) =>
      exception.status === "ACTIVE" &&
      new Date(exception.expiresAt).getTime() >= now
  ).length;
}

export function getSystemGovernanceRecommendations(
  input: GovernanceRecommendationInput
): GovernanceRecommendationSummary {
  const recommendations: GovernanceRecommendation[] = [];
  const requiredStages = getRequiredStages(input);
  const approvedStages = getApprovedStages(input.governanceReviews);
  const activeExceptionCount = getActiveExceptionCount(input.governanceExceptions);
  const workflow = getSystemWorkflowSummary({
    id: input.id,
    status: input.status,
    riskAssessmentsCount: input.riskAssessmentsCount,
    policyAssignmentsCount: input.policyAssignments.length,
    notAssessedAssignments: input.policyAssignments.filter(
      (assignment) => assignment.complianceStatus === "NOT_ASSESSED"
    ).length,
    nonCompliantAssignments: input.policyAssignments.filter(
      (assignment) => assignment.complianceStatus === "NON_COMPLIANT"
    ).length,
    partialAssignments: input.policyAssignments.filter(
      (assignment) => assignment.complianceStatus === "PARTIALLY_COMPLIANT"
    ).length,
    latestApprovalDecision: input.latestApprovalDecision ?? null,
    nextReviewDate: input.nextReviewDate,
    activeExceptionCount,
    requiredStages,
    approvedStages,
  });

  const openIncidents = input.governanceIncidents.filter(
    (incident) => incident.status === "OPEN" || incident.status === "ACKNOWLEDGED"
  );

  if (openIncidents.length > 0) {
    addRecommendation(recommendations, {
      key: "open-incidents",
      title:
        openIncidents.length === 1
          ? "Resolve the open governance incident"
          : `Resolve ${openIncidents.length} open governance incidents`,
      detail:
        openIncidents.length === 1
          ? `${openIncidents[0]?.title} is still open and should be addressed before continued approval or deployment changes.`
          : "This system has unresolved governance incidents that should be remediated and closed.",
      href: `/registry/${input.id}`,
      tone: "critical",
      source: "incident",
      priority: 100,
    });
  }

  const missingStages = requiredStages.filter((stage) => !approvedStages.includes(stage));
  if (missingStages.length > 0) {
    addRecommendation(recommendations, {
      key: "missing-stages",
      title:
        missingStages.length === 1
          ? `Complete ${GOVERNANCE_STAGE_LABELS[missingStages[0]]} review`
          : `Complete ${missingStages.length} remaining stage reviews`,
      detail: `Required signoff is still missing for ${missingStages
        .map((stage) => GOVERNANCE_STAGE_LABELS[stage])
        .join(", ")}.`,
      href: `/registry/${input.id}`,
      tone: "warning",
      source: "workflow",
      priority: 85,
    });
  }

  if (input.latestApprovalDecision === "CHANGES_REQUESTED") {
    addRecommendation(recommendations, {
      key: "approval-changes-requested",
      title: "Address requested approval changes",
      detail:
        "The latest approval review requested follow-up work before the system can move forward.",
      href: `/registry/${input.id}`,
      tone: "critical",
      source: "workflow",
      priority: 95,
    });
  }

  if (input.latestApprovalDecision === "REVOKED") {
    addRecommendation(recommendations, {
      key: "approval-revoked",
      title: "Re-open governance review",
      detail:
        "A previous approval was revoked, so the system needs fresh review before continued use.",
      href: `/registry/${input.id}`,
      tone: "critical",
      source: "workflow",
      priority: 95,
    });
  }

  const reviewOverdue =
    !!input.nextReviewDate && new Date(input.nextReviewDate).getTime() < Date.now();
  if (reviewOverdue) {
    addRecommendation(recommendations, {
      key: "review-overdue",
      title: "Renew the governance review",
      detail:
        "This system is past its scheduled review date and should be re-reviewed before continued approval.",
      href: `/registry/${input.id}`,
      tone: "critical",
      source: "workflow",
      priority: 92,
    });
  }

  const soonExpiringException = input.governanceExceptions.find((exception) => {
    if (exception.status !== "ACTIVE") return false;
    const expiration = new Date(exception.expiresAt).getTime();
    const daysUntilExpiration = (expiration - Date.now()) / 86400000;
    return daysUntilExpiration >= 0 && daysUntilExpiration <= 14;
  });

  if (soonExpiringException) {
    addRecommendation(recommendations, {
      key: "exception-expiring",
      title: "Renew or close the active exception",
      detail:
        "A governance exception expires within the next 14 days. Renew it or close the underlying gap before it lapses.",
      href: `/registry/${input.id}`,
      tone: "warning",
      source: "exception",
      priority: 78,
    });
  } else if (activeExceptionCount > 0) {
    addRecommendation(recommendations, {
      key: "active-exceptions",
      title: "Review active governance exceptions",
      detail:
        "This system has active waivers in place. Confirm they still reflect the current deployment and policy posture.",
      href: `/registry/${input.id}`,
      tone: "info",
      source: "exception",
      priority: 40,
    });
  }

  for (const assignment of input.policyAssignments) {
    const rules = parsePolicyRules(assignment.policy.rules);
    if (Object.keys(rules).length === 0) continue;

    const evaluation = evaluatePolicyRules(rules, {
      vendor: input.vendor,
      department: input.department,
      status: input.status,
      modelType: input.modelType,
      dataSensitivity: input.dataSensitivity,
      reviewIntervalDays: input.reviewIntervalDays,
      riskLevel: input.riskLevel,
      requireOwnerApproval: input.requireOwnerApproval,
      requireSecurityApproval: input.requireSecurityApproval,
      requireLegalApproval: input.requireLegalApproval,
      requireComplianceApproval: input.requireComplianceApproval,
      activeExceptionCount,
    });

    if (evaluation.blockingViolations.length > 0) {
      addRecommendation(recommendations, {
        key: `policy-blocking-${assignment.id}`,
        title: `Resolve ${assignment.policy.name} policy blockers`,
        detail:
          evaluation.recommendations[0] ??
          evaluation.blockingViolations[0] ??
          "This policy still has blocking rule violations.",
        href: `/registry/${input.id}?tab=compliance`,
        tone: "critical",
        source: "policy",
        priority: 90,
      });
      continue;
    }

    if (evaluation.waivedViolations.length > 0) {
      addRecommendation(recommendations, {
        key: `policy-waived-${assignment.id}`,
        title: `Confirm exception coverage for ${assignment.policy.name}`,
        detail:
          evaluation.recommendations[0] ??
          "This policy currently relies on an active exception to remain passable.",
        href: `/registry/${input.id}?tab=compliance`,
        tone: "warning",
        source: "policy",
        priority: 72,
      });
      continue;
    }

    if (evaluation.advisories.length > 0) {
      addRecommendation(recommendations, {
        key: `policy-advisory-${assignment.id}`,
        title: `Review advisory findings for ${assignment.policy.name}`,
        detail:
          evaluation.recommendations[0] ??
          "This policy has advisory findings worth reviewing even though they do not block approval.",
        href: `/registry/${input.id}?tab=compliance`,
        tone: "info",
        source: "policy",
        priority: 38,
      });
    }
  }

  if (
    input.riskAssessmentsCount > 0 &&
    input.policyAssignments.length > 0 &&
    workflow.readiness === "ready" &&
    input.latestApprovalDecision !== "APPROVED"
  ) {
    addRecommendation(recommendations, {
      key: "record-approval",
      title: "Record the formal approval decision",
      detail:
        "Core governance steps are complete. Capture the approval outcome so the system can move into monitored operation.",
      href: `/registry/${input.id}`,
      tone: "success",
      source: "workflow",
      priority: 55,
    });
  }

  if ((input.linkedDiscoveriesCount ?? 0) > 0) {
    addRecommendation(recommendations, {
      key: "linked-discoveries",
      title: "Review linked shadow AI discoveries",
      detail:
        "Linked shadow AI findings can help validate real-world usage, ownership, and rollout scope for this system.",
      href: `/registry/${input.id}`,
      tone: "info",
      source: "monitoring",
      priority: 28,
    });
  }

  if (recommendations.length === 0) {
    addRecommendation(recommendations, {
      key: "monitoring",
      title: "Continue monitoring telemetry and alerts",
      detail:
        "This system has baseline governance coverage. Keep an eye on usage, drift, alerts, and upcoming review dates.",
      href: "/oversight",
      tone: "success",
      source: "monitoring",
      priority: 10,
    });
  }

  for (const action of workflow.actions) {
    addRecommendation(recommendations, {
      key: `workflow-${action.label}`,
      title: action.label,
      detail: workflow.message,
      href: action.href,
      tone: action.tone,
      source: "workflow",
      priority:
        action.tone === "critical"
          ? 88
          : action.tone === "warning"
            ? 58
            : action.tone === "info"
              ? 26
              : 50,
    });
  }

  recommendations.sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title));

  return {
    workflow,
    primary: recommendations[0] ?? null,
    recommendations,
  };
}
