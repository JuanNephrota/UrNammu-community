import type { ComplianceStatus, EuAiActRiskTier, GovernanceReviewStage } from "@prisma/client";

/**
 * Shared logic for computing the specific reasons a system cannot yet be
 * approved. Used both by the approval API (for error responses) and by the
 * Approval Decision card (for inline UI) so the two surfaces stay aligned.
 *
 * Each blocker returns a short, user-facing `message` and a `href` the user
 * can click to resolve it.
 */

export type ApprovalBlocker = {
  message: string;
  href?: string;
  category:
    | "risk"
    | "policy"
    | "compliance_status"
    | "compliance_evidence"
    | "policy_rule"
    | "stage_review"
    | "review_date"
    | "eu_ai_act_classification"
    | "eu_ai_act_prohibited"
    | "eu_ai_act_obligation";
};

export type ApprovalBlockerInput = {
  systemId: string;
  riskAssessmentsCount: number;
  policyAssignments: Array<{
    id: string;
    complianceStatus: ComplianceStatus;
    evidenceProvided: boolean;
    policy: { id: string; name: string };
    blockingRuleViolations: string[];
  }>;
  requiredStages: GovernanceReviewStage[];
  approvedStages: Set<GovernanceReviewStage>;
  nextReviewDate?: Date | string | null;
  /**
   * EU AI Act posture. Optional so callers that have not loaded it keep the
   * pre-existing blocker set; when supplied, an unclassified system gets a soft
   * nudge, a PROHIBITED tier hard-blocks, and unassessed applicable articles
   * on a high-risk system are surfaced as a soft warning.
   */
  euAiAct?: {
    classified: boolean;
    tier: EuAiActRiskTier | null;
    unassessedObligations: number;
    applicableArticles: number;
  };
};

const STAGE_LABELS: Record<GovernanceReviewStage, string> = {
  OWNER: "Owner",
  SECURITY: "Security",
  LEGAL: "Legal",
  COMPLIANCE: "Compliance",
};

export function getApprovalBlockers(
  input: ApprovalBlockerInput
): ApprovalBlocker[] {
  const blockers: ApprovalBlocker[] = [];
  const complianceHref = `/registry/${input.systemId}?tab=compliance`;

  if (input.riskAssessmentsCount === 0) {
    blockers.push({
      category: "risk",
      message: "No risk assessment on file. Run the initial assessment before approval.",
      href: `/risk-center/assessments/new?systemId=${input.systemId}`,
    });
  }

  if (input.policyAssignments.length === 0) {
    blockers.push({
      category: "policy",
      message: "No governing policies assigned. Assign at least one policy before approval.",
      href: complianceHref,
    });
  }

  for (const assignment of input.policyAssignments) {
    if (assignment.complianceStatus === "NOT_ASSESSED") {
      blockers.push({
        category: "compliance_status",
        message: `Policy "${assignment.policy.name}" has not been assessed. Set its compliance status and attach supporting evidence.`,
        href: complianceHref,
      });
    } else if (assignment.complianceStatus === "NON_COMPLIANT") {
      blockers.push({
        category: "compliance_status",
        message: `Policy "${assignment.policy.name}" is Non-Compliant. Remediate the gap or request an exception before approval.`,
        href: complianceHref,
      });
    } else if (assignment.complianceStatus === "PARTIALLY_COMPLIANT" && !assignment.evidenceProvided) {
      // Partial is allowed to approve but still deserves a nudge when evidence is empty.
      blockers.push({
        category: "compliance_evidence",
        message: `Policy "${assignment.policy.name}" is Partially Compliant but has no evidence recorded. Document which requirements are met and which remain open.`,
        href: complianceHref,
      });
    } else if (
      (assignment.complianceStatus === "COMPLIANT" ||
        assignment.complianceStatus === "PARTIALLY_COMPLIANT") &&
      !assignment.evidenceProvided
    ) {
      // Compliant-with-no-evidence is a soft warning (not a hard block in the API)
      // but we still surface it to the reviewer so they know what's missing.
      blockers.push({
        category: "compliance_evidence",
        message: `Policy "${assignment.policy.name}" is marked Compliant but has no evidence text. Describe the controls, testing, or artifacts that support the rating.`,
        href: complianceHref,
      });
    }

    if (assignment.blockingRuleViolations.length > 0) {
      blockers.push({
        category: "policy_rule",
        message: `Policy "${assignment.policy.name}" has a blocking rule violation: ${assignment.blockingRuleViolations[0]}`,
        href: complianceHref,
      });
    }
  }

  const missingStages = input.requiredStages.filter(
    (stage) => !input.approvedStages.has(stage)
  );
  if (missingStages.length > 0) {
    blockers.push({
      category: "stage_review",
      message: `Missing required approval${missingStages.length > 1 ? "s" : ""}: ${missingStages
        .map((stage) => STAGE_LABELS[stage])
        .join(", ")}.`,
      href: `/registry/${input.systemId}`,
    });
  }

  if (input.euAiAct) {
    const wizardHref = `/registry/${input.systemId}/eu-ai-act`;
    if (!input.euAiAct.classified) {
      blockers.push({
        category: "eu_ai_act_classification",
        message:
          "EU AI Act classification has not been run. Determine the risk tier so the right obligations are on file.",
        href: wizardHref,
      });
    } else if (input.euAiAct.tier === "PROHIBITED") {
      blockers.push({
        category: "eu_ai_act_prohibited",
        message:
          "EU AI Act classification identified a prohibited practice (Art. 5). Remove the practice and re-run the classification before approval.",
        href: wizardHref,
      });
    } else if (input.euAiAct.tier === "HIGH_RISK" && input.euAiAct.unassessedObligations > 0) {
      blockers.push({
        category: "eu_ai_act_obligation",
        message: `High-risk under the EU AI Act with ${input.euAiAct.unassessedObligations} of ${input.euAiAct.applicableArticles} applicable articles still unassessed. Record a status for each on the Compliance tab.`,
        href: `/registry/${input.systemId}?tab=compliance&framework=EU_AI_ACT`,
      });
    }
  }

  if (!input.nextReviewDate) {
    blockers.push({
      category: "review_date",
      message: "No next-review date set. Edit the system to set a review cadence.",
      href: `/registry/${input.systemId}/edit`,
    });
  } else if (new Date(input.nextReviewDate).getTime() < Date.now()) {
    blockers.push({
      category: "review_date",
      message: "Next-review date is in the past. Run a re-assessment or update the review cadence.",
      href: `/registry/${input.systemId}`,
    });
  }

  return blockers;
}

/**
 * Hard-blocking subset — the API rejects APPROVED decisions only for these.
 * Soft evidence warnings (compliant-but-no-evidence) are surfaced to the UI
 * but do not prevent approval, matching the existing API semantics.
 */
const SOFT_CATEGORIES: ReadonlySet<ApprovalBlocker["category"]> = new Set([
  "compliance_evidence",
  "eu_ai_act_classification",
  "eu_ai_act_obligation",
]);

export function isHardBlocker(blocker: ApprovalBlocker): boolean {
  return !SOFT_CATEGORIES.has(blocker.category);
}
