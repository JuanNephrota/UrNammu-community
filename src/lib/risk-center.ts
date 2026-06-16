import type {
  AlertStatus,
  ApprovalDecision,
  AutonomyLevel,
  ComplianceStatus,
  DataSensitivity,
  GovernanceReviewStage,
  RiskLevel,
} from "@prisma/client";

export type RiskDimensionKey =
  | "biasScore"
  | "securityScore"
  | "privacyScore"
  | "fairnessScore"
  | "performanceScore"
  | "transparencyScore";

export type RiskScores = Record<RiskDimensionKey, number>;

export type RiskSystemContext = {
  id: string;
  name: string;
  department: string;
  vendor?: string | null;
  modelType?: string | null;
  useCase?: string | null;
  dataInputs?: string | null;
  dataOutputs?: string | null;
  dataSensitivity: DataSensitivity;
  reviewIntervalDays?: number;
};

export type AgentRiskInput = {
  id: string;
  name: string;
  autonomyLevel: AutonomyLevel;
  humanReviewRequired: boolean;
  humanReviewTriggers?: unknown;
  connectedSystems?: unknown;
  riskLevel: RiskLevel;
  status?: string;
  aiSystemId?: string | null;
};

export type AgentRiskSummary = {
  id: string;
  name: string;
  overlayScore: number;
  recommendedRiskLevel: RiskLevel;
  reviewNeeded: boolean;
  concerns: string[];
};

export function getRequiredStages(input: {
  requireOwnerApproval?: boolean;
  requireSecurityApproval?: boolean;
  requireLegalApproval?: boolean;
  requireComplianceApproval?: boolean;
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
  const latestByStage = new Map<GovernanceReviewStage, boolean>();
  for (const review of reviews) {
    if (!latestByStage.has(review.stage)) {
      latestByStage.set(review.stage, review.approved);
    }
  }

  return Array.from(latestByStage.entries())
    .filter(([, approved]) => approved)
    .map(([stage]) => stage);
}

export type RiskControlGap = {
  key: string;
  title: string;
  detail: string;
  tone: "critical" | "warning" | "info";
  href: string;
};

type ControlGapInput = {
  system: RiskSystemContext;
  scores: RiskScores;
  agents?: AgentRiskInput[];
  policyAssignments: Array<{ complianceStatus: ComplianceStatus }>;
  evidenceArtifactCount: number;
  requiredStages: GovernanceReviewStage[];
  approvedStages: GovernanceReviewStage[];
  latestApprovalDecision?: ApprovalDecision | null;
  openIncidentCount: number;
};

type ReassessmentDriftInput = {
  before: Partial<RiskSystemContext>;
  after: Partial<RiskSystemContext>;
  hasAssessments: boolean;
};

const dimensionLabels: Record<RiskDimensionKey, string> = {
  biasScore: "Bias",
  securityScore: "Security",
  privacyScore: "Privacy",
  fairnessScore: "Fairness",
  performanceScore: "Performance",
  transparencyScore: "Transparency",
};

const governanceStageLabels: Record<GovernanceReviewStage, string> = {
  OWNER: "Owner",
  SECURITY: "Security",
  LEGAL: "Legal",
  COMPLIANCE: "Compliance",
};

const autonomyOverlayScore: Record<AutonomyLevel, number> = {
  MANUAL: 0,
  HUMAN_IN_THE_LOOP: 6,
  HUMAN_ON_THE_LOOP: 12,
  SUPERVISED: 18,
  FULL_AUTONOMY: 28,
};

function includesAny(value: string | null | undefined, patterns: string[]) {
  if (!value) return false;
  const lower = value.toLowerCase();
  return patterns.some((pattern) => lower.includes(pattern));
}

export function averageRiskScore(scores: RiskScores) {
  return Object.values(scores).reduce((sum, value) => sum + value, 0) / 6;
}

function riskLevelRank(level: RiskLevel) {
  if (level === "CRITICAL") return 4;
  if (level === "HIGH") return 3;
  if (level === "MEDIUM") return 2;
  if (level === "LOW") return 1;
  return 0;
}

function getConnectedSystemCount(input: unknown) {
  return Array.isArray(input) ? input.filter((item) => typeof item === "string" && item.trim()).length : 0;
}

function getTriggerCount(input: unknown) {
  return Array.isArray(input) ? input.length : 0;
}

export function getAgentRiskSummary(agent: AgentRiskInput, parentRiskLevel?: RiskLevel): AgentRiskSummary {
  let overlayScore = autonomyOverlayScore[agent.autonomyLevel];
  const concerns: string[] = [];

  if (agent.autonomyLevel === "FULL_AUTONOMY") {
    concerns.push("Runs with full autonomy, which increases execution and oversight risk.");
  } else if (agent.autonomyLevel === "SUPERVISED") {
    concerns.push("Operates in supervised mode and still needs explicit oversight around higher-risk actions.");
  } else if (agent.autonomyLevel === "HUMAN_ON_THE_LOOP") {
    concerns.push("Relies on human-on-the-loop oversight, so escalation and intervention paths should be clear.");
  }

  if (!agent.humanReviewRequired && autonomyOverlayScore[agent.autonomyLevel] >= 12) {
    overlayScore += 12;
    concerns.push("Autonomy is elevated without required human review.");
  }

  const connectedSystemCount = getConnectedSystemCount(agent.connectedSystems);
  if (connectedSystemCount >= 3) {
    overlayScore += 8;
    concerns.push(`Touches ${connectedSystemCount} connected systems, which expands operational blast radius.`);
  } else if (connectedSystemCount > 0) {
    overlayScore += 4;
    concerns.push(`Connected to ${connectedSystemCount} downstream system${connectedSystemCount === 1 ? "" : "s"}.`);
  }

  if (agent.humanReviewRequired && getTriggerCount(agent.humanReviewTriggers) === 0) {
    overlayScore += 6;
    concerns.push("Human review is required, but no review triggers are documented.");
  }

  if (!agent.aiSystemId) {
    overlayScore += 10;
    concerns.push("Not linked to a parent AI system, so governance ownership is less clear.");
  }

  if (parentRiskLevel && riskLevelRank(agent.riskLevel) > riskLevelRank(parentRiskLevel)) {
    overlayScore += 8;
    concerns.push(`Agent risk level (${agent.riskLevel}) exceeds the parent system's current tier (${parentRiskLevel}).`);
  }

  const normalizedScore = Math.min(100, overlayScore);
  return {
    id: agent.id,
    name: agent.name,
    overlayScore: normalizedScore,
    recommendedRiskLevel: scoreToRiskLevel(normalizedScore + 40),
    reviewNeeded:
      normalizedScore >= 18 ||
      (!agent.humanReviewRequired && autonomyOverlayScore[agent.autonomyLevel] >= 12) ||
      !agent.aiSystemId,
    concerns,
  };
}

export function getSystemAgentOverlay(
  agents: AgentRiskInput[] | undefined,
  parentRiskLevel?: RiskLevel
) {
  const summaries = (agents ?? []).map((agent) => getAgentRiskSummary(agent, parentRiskLevel));
  const maxOverlayScore = summaries.reduce((max, summary) => Math.max(max, summary.overlayScore), 0);
  const reviewNeededCount = summaries.filter((summary) => summary.reviewNeeded).length;

  return {
    summaries,
    maxOverlayScore,
    reviewNeededCount,
  };
}

export function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MEDIUM";
  if (score >= 20) return "LOW";
  return "MINIMAL";
}

export function getRiskAssessmentPrompts(system: RiskSystemContext, agents?: AgentRiskInput[]) {
  const prompts = new Set<string>();

  if (system.dataSensitivity === "CONFIDENTIAL" || system.dataSensitivity === "RESTRICTED") {
    prompts.add("Probe privacy and security controls around sensitive data handling, retention, and prompt injection exposure.");
  }

  if (
    includesAny(system.useCase, [
      "customer",
      "employee",
      "hiring",
      "support",
      "approval",
      "finance",
      "health",
      "legal",
      "hr",
    ])
  ) {
    prompts.add("Add follow-up scrutiny on fairness, transparency, and human review for user-impacting decisions or guidance.");
  }

  if (
    includesAny(system.useCase, [
      "agent",
      "autonom",
      "workflow",
      "copilot",
      "assistant",
      "automation",
    ])
  ) {
    prompts.add("Assess performance, failure modes, and escalation paths for agentic or semi-autonomous behavior.");
  }

  const agentOverlay = getSystemAgentOverlay(agents);
  if (agentOverlay.reviewNeededCount > 0) {
    prompts.add("Review linked agents for autonomy level, human review coverage, escalation triggers, and downstream system access.");
  }

  if (system.vendor || system.modelType) {
    prompts.add("Confirm vendor and model dependency risks, including model drift, service changes, and fallback behavior.");
  }

  if (
    includesAny(`${system.dataInputs ?? ""} ${system.dataOutputs ?? ""}`, [
      "pii",
      "ssn",
      "customer",
      "medical",
      "financial",
      "source code",
      "contract",
    ])
  ) {
    prompts.add("Review whether the documented inputs and outputs expand the real data sensitivity beyond the current classification.");
  }

  if (prompts.size === 0) {
    prompts.add("Validate the intended use case, operating environment, and real-world failure modes before finalizing the score.");
  }

  return Array.from(prompts);
}

export function getRecommendedRiskTier(input: {
  system: RiskSystemContext;
  scores: RiskScores;
  agents?: AgentRiskInput[];
}) {
  const baseScore = averageRiskScore(input.scores);
  let adjustedScore = baseScore;
  const reasons: string[] = [];

  const topDimensions = Object.entries(input.scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .filter(([, score]) => score >= 50) as [RiskDimensionKey, number][];

  for (const [dimension, score] of topDimensions) {
    reasons.push(`${dimensionLabels[dimension]} risk is elevated at ${Math.round(score)}.`);
  }

  if (input.system.dataSensitivity === "RESTRICTED") {
    adjustedScore += 12;
    reasons.push("Restricted data pushes the system into a stricter review path.");
  } else if (input.system.dataSensitivity === "CONFIDENTIAL") {
    adjustedScore += 7;
    reasons.push("Confidential data raises the expected control burden.");
  }

  if (
    includesAny(input.system.useCase, [
      "customer",
      "employee",
      "hiring",
      "approval",
      "finance",
      "health",
    ])
  ) {
    adjustedScore += 8;
    reasons.push("The use case appears to affect people or decisions, which increases governance scrutiny.");
  }

  if (
    includesAny(input.system.useCase, [
      "agent",
      "autonom",
      "workflow",
      "copilot",
      "automation",
    ])
  ) {
    adjustedScore += 6;
    reasons.push("Agentic or workflow automation behavior adds operational and oversight risk.");
  }

  if (input.system.vendor) {
    adjustedScore += 3;
    reasons.push("Third-party vendor dependency adds external model and service-change risk.");
  }

  const agentOverlay = getSystemAgentOverlay(input.agents);
  if (agentOverlay.maxOverlayScore >= 24) {
    adjustedScore += 10;
    reasons.push("Linked agents add substantial autonomy or operational blast-radius risk.");
  } else if (agentOverlay.maxOverlayScore >= 12) {
    adjustedScore += 5;
    reasons.push("Linked agents add moderate autonomy and control-surface risk.");
  }

  if (agentOverlay.reviewNeededCount > 0) {
    reasons.push(
      `${agentOverlay.reviewNeededCount} linked agent${agentOverlay.reviewNeededCount === 1 ? "" : "s"} should receive dedicated agent-level review.`
    );
  }

  adjustedScore = Math.min(100, Math.round(adjustedScore * 10) / 10);
  const recommendedRiskLevel = scoreToRiskLevel(adjustedScore);

  if (reasons.length === 0) {
    reasons.push("Current dimension scores do not indicate strong escalation beyond the measured baseline.");
  }

  return {
    baseScore: Math.round(baseScore * 10) / 10,
    adjustedScore,
    recommendedRiskLevel,
    reasons,
  };
}

export function getRiskControlGaps(input: ControlGapInput): RiskControlGap[] {
  const gaps: RiskControlGap[] = [];
  const recommendedTier = getRecommendedRiskTier({
    system: input.system,
    scores: input.scores,
    agents: input.agents,
  });
  const agentOverlay = getSystemAgentOverlay(input.agents, recommendedTier.recommendedRiskLevel);

  const notAssessedAssignments = input.policyAssignments.filter(
    (assignment) => assignment.complianceStatus === "NOT_ASSESSED"
  ).length;
  const nonCompliantAssignments = input.policyAssignments.filter(
    (assignment) => assignment.complianceStatus === "NON_COMPLIANT"
  ).length;
  const partialAssignments = input.policyAssignments.filter(
    (assignment) => assignment.complianceStatus === "PARTIALLY_COMPLIANT"
  ).length;
  const missingStages = input.requiredStages.filter(
    (stage) => !input.approvedStages.includes(stage)
  );

  if (input.policyAssignments.length === 0) {
    gaps.push({
      key: "policy-missing",
      title: "Assign a governing policy",
      detail:
        "This system has no policy assignment yet, so its risk posture is not tied to enforceable governance controls.",
      tone: "critical",
      href: `/registry/${input.system.id}?tab=compliance`,
    });
  }

  if (nonCompliantAssignments > 0 || notAssessedAssignments > 0 || partialAssignments > 0) {
    gaps.push({
      key: "policy-evidence",
      title: "Update compliance evidence for assigned policies",
      detail:
        nonCompliantAssignments > 0
          ? "One or more assigned policies are currently non-compliant and should be remediated before approval."
          : notAssessedAssignments > 0
            ? "Assigned policies still need evidence or assessment before this risk posture is trustworthy."
            : "Some assigned policies are only partially compliant and need follow-up evidence.",
      tone: nonCompliantAssignments > 0 ? "critical" : "warning",
      href: `/registry/${input.system.id}?tab=compliance`,
    });
  }

  if (
    ["HIGH", "CRITICAL"].includes(recommendedTier.recommendedRiskLevel) &&
    input.evidenceArtifactCount === 0
  ) {
    gaps.push({
      key: "evidence-missing",
      title: "Attach supporting evidence for the high-risk assessment",
      detail:
        "High-risk systems should carry supporting artifacts such as reviews, test evidence, model documentation, or vendor materials.",
      tone: "warning",
      href: `/registry/${input.system.id}`,
    });
  }

  if (missingStages.length > 0) {
    gaps.push({
      key: "stage-signoff",
      title: "Complete required governance signoff",
      detail: `Missing signoff from ${missingStages
        .map((stage) => governanceStageLabels[stage])
        .join(", ")}.`,
      tone: "warning",
      href: `/registry/${input.system.id}`,
    });
  }

  if (
    ["HIGH", "CRITICAL"].includes(recommendedTier.recommendedRiskLevel) &&
    input.latestApprovalDecision !== "APPROVED"
  ) {
    gaps.push({
      key: "approval-route",
      title: "Route this system through formal approval",
      detail:
        "The recommended tier is high enough that the system should complete formal governance approval before continued rollout.",
      tone: "warning",
      href: `/registry/${input.system.id}`,
    });
  }

  if (input.openIncidentCount > 0) {
    gaps.push({
      key: "open-incidents",
      title: "Resolve open incidents before accepting residual risk",
      detail:
        input.openIncidentCount === 1
          ? "There is an open governance incident linked to this system."
          : `There are ${input.openIncidentCount} open governance incidents linked to this system.`,
      tone: "critical",
      href: `/registry/${input.system.id}`,
    });
  }

  if (
    ["HIGH", "CRITICAL"].includes(recommendedTier.recommendedRiskLevel) &&
    (input.system.reviewIntervalDays ?? 365) > 180
  ) {
    gaps.push({
      key: "review-cadence",
      title: "Tighten the review cadence",
      detail:
        "The recommended tier suggests a shorter review interval so changes and incidents are reassessed more quickly.",
      tone: "info",
      href: `/registry/${input.system.id}`,
    });
  }

  if (agentOverlay.reviewNeededCount > 0) {
    gaps.push({
      key: "agent-review",
      title: "Review linked agents with elevated autonomy",
      detail:
        agentOverlay.reviewNeededCount === 1
          ? "One linked agent has autonomy or oversight signals that merit dedicated review."
          : `${agentOverlay.reviewNeededCount} linked agents have autonomy or oversight signals that merit dedicated review.`,
      tone: agentOverlay.maxOverlayScore >= 24 ? "warning" : "info",
      href: `/registry/${input.system.id}?tab=agents`,
    });
  }

  return gaps;
}

export function getRiskReassessmentDrift(input: ReassessmentDriftInput) {
  const reassessmentFields = [
    "vendor",
    "modelType",
    "dataSensitivity",
    "useCase",
    "dataInputs",
    "dataOutputs",
  ] as const;

  const changedFields = reassessmentFields.filter(
    (field) => input.after[field] !== undefined && input.before[field] !== input.after[field]
  );

  if (!input.hasAssessments || changedFields.length === 0) {
    return {
      requiresReassessment: false,
      changedFields,
      severity: "MEDIUM" as const,
      title: "",
      description: "",
    };
  }

  const severity: "HIGH" | "MEDIUM" = changedFields.some(
    (field) =>
      field === "dataSensitivity" ||
      field === "dataInputs" ||
      field === "dataOutputs" ||
      field === "useCase"
  )
    ? "HIGH"
    : "MEDIUM";

  return {
    requiresReassessment: true,
    changedFields,
    severity,
    title: `Risk reassessment recommended`,
    description: `Risk-sensitive fields changed (${changedFields.join(", ")}). Review the latest assessment and run a reassessment if the deployment scope has materially changed.`,
  };
}

export function isIncidentOpen(status: AlertStatus) {
  return status === "OPEN" || status === "ACKNOWLEDGED";
}
