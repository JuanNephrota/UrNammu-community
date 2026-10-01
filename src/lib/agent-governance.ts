/**
 * Agent governance — charter, approval blockers, workflow summary and the
 * "what's left" checklist for AI agents. Pure: no Prisma, no React, so the
 * agent detail page, the approval API and tests share one definition.
 *
 * This is the agent counterpart of `approval-blockers.ts` +
 * `governance-workflow.ts` + `system-onboarding.ts`. It differs where agents
 * differ from systems (docs/plans/agentic-governance-playbook.md §2):
 *
 * - The **charter** (purpose, in-scope actions, decision boundaries) must be
 *   written before approval — "if their purpose, boundaries and success
 *   criteria have not been distinctly defined, they will be of minimal value".
 * - **Autonomy dictates controls.** A FULL_AUTONOMY agent must have MCP
 *   enforcement on with a non-empty server allowlist; there is no human to
 *   catch a bad tool call. SUPERVISED gets the same as a recommendation.
 * - **Risk basis** comes from the parent system's formal assessment (agents
 *   are overlays in the Risk Center) or, failing that, an agent risk review.
 *   HIGH/CRITICAL agents need one of them; lower tiers are only nudged.
 * - A **suspended** agent cannot be approved. Resume it first, or keep it
 *   suspended and don't.
 */

import type {
  AISystemStatus,
  ApprovalDecision,
  AutonomyLevel,
  GovernanceReviewStage,
  RiskLevel,
} from "@prisma/client";
import type { ChecklistItem } from "./workflow";
import { GOVERNANCE_STAGE_LABELS, type GovernanceAction, type SystemWorkflowSummary } from "./governance-workflow";

export type AgentGovernanceInput = {
  id: string;
  name: string;
  status: AISystemStatus;
  riskLevel: RiskLevel;
  autonomyLevel: AutonomyLevel;
  humanReviewRequired: boolean;
  /** All declared triggers, notes included. */
  humanReviewTriggersCount: number;
  /** Triggers the proxies can evaluate (everything except notes). */
  enforceableTriggersCount: number;
  humanReviewEnforcement: string;

  purpose: string | null;
  inScopeActions: string[];
  outOfScopeActions: string[];
  decisionBoundaries: string | null;
  successCriteria: string | null;

  aiSystemId: string | null;
  /** Formal Risk Center assessments on the parent system. */
  parentRiskAssessmentsCount: number;
  /** AgentRiskReview rows (heuristic + AI review). */
  riskReviewsCount: number;

  mcpEnforcement: string;
  mcpServerAllowlist: string[];
  mcpToolAllowlist: string[];
  /** Observed tools/servers not on the allowlist. */
  unapprovedToolProfiles: number;
  /** Any proxy traffic ever attributed to this agent. */
  observedActivity: boolean;

  suspendedAt: Date | string | null;

  requireOwnerApproval: boolean;
  requireSecurityApproval: boolean;
  requireLegalApproval: boolean;
  requireComplianceApproval: boolean;
  /** Newest first. */
  governanceReviews: Array<{ stage: GovernanceReviewStage; approved: boolean }>;
  latestApprovalDecision: ApprovalDecision | null;
  nextReviewDate: Date | string | null;
};

/** `humanReviewTriggers` is free-form JSON today: a list, an object, or a string. */
export function countHumanReviewTriggers(value: unknown): number {
  if (value == null) return 0;
  if (Array.isArray(value)) return value.filter((v) => v != null && String(v).trim() !== "").length;
  if (typeof value === "string") return value.trim() ? 1 : 0;
  if (typeof value === "object") return Object.keys(value as object).length;
  return 0;
}

export type AgentBlockerCategory =
  | "charter"
  | "suspended"
  | "autonomy_controls"
  | "human_review"
  | "risk"
  | "parent_system"
  | "stage_review"
  | "review_date"
  | "mcp_unapproved";

export type AgentApprovalBlocker = {
  category: AgentBlockerCategory;
  /** Short label for action lists. */
  title: string;
  /** Full user-facing message. */
  message: string;
  href?: string;
  /** Soft blockers are shown but do not stop approval. */
  soft: boolean;
};

export type AgentWorkflowSummary = SystemWorkflowSummary;

const HIGH_TIERS: ReadonlySet<RiskLevel> = new Set(["HIGH", "CRITICAL"]);

export function getAgentRequiredStages(input: {
  requireOwnerApproval: boolean;
  requireSecurityApproval: boolean;
  requireLegalApproval: boolean;
  requireComplianceApproval: boolean;
}): GovernanceReviewStage[] {
  return [
    ...(input.requireOwnerApproval ? (["OWNER"] as const) : []),
    ...(input.requireSecurityApproval ? (["SECURITY"] as const) : []),
    ...(input.requireLegalApproval ? (["LEGAL"] as const) : []),
    ...(input.requireComplianceApproval ? (["COMPLIANCE"] as const) : []),
  ];
}

/** Latest decision per stage wins; `reviews` must be newest first. */
export function getAgentApprovedStages(
  reviews: Array<{ stage: GovernanceReviewStage; approved: boolean }>
): Set<GovernanceReviewStage> {
  const seen = new Set<GovernanceReviewStage>();
  const approved = new Set<GovernanceReviewStage>();
  for (const review of reviews) {
    if (seen.has(review.stage)) continue;
    seen.add(review.stage);
    if (review.approved) approved.add(review.stage);
  }
  return approved;
}

export type CharterStatus = {
  complete: boolean;
  missing: Array<"purpose" | "in-scope actions" | "decision boundaries">;
  /** Optional pieces that are still empty. */
  recommended: Array<"out-of-scope actions" | "success criteria">;
};

export function getCharterStatus(input: {
  purpose: string | null;
  inScopeActions: string[];
  outOfScopeActions: string[];
  decisionBoundaries: string | null;
  successCriteria: string | null;
}): CharterStatus {
  const missing: CharterStatus["missing"] = [];
  if (!input.purpose?.trim()) missing.push("purpose");
  if (input.inScopeActions.filter((a) => a.trim()).length === 0) missing.push("in-scope actions");
  if (!input.decisionBoundaries?.trim()) missing.push("decision boundaries");
  const recommended: CharterStatus["recommended"] = [];
  if (input.outOfScopeActions.filter((a) => a.trim()).length === 0) recommended.push("out-of-scope actions");
  if (!input.successCriteria?.trim()) recommended.push("success criteria");
  return { complete: missing.length === 0, missing, recommended };
}

function isPast(date: Date | string | null | undefined): boolean {
  return !!date && new Date(date).getTime() < Date.now();
}

export function getAgentApprovalBlockers(input: AgentGovernanceInput): AgentApprovalBlocker[] {
  const blockers: AgentApprovalBlocker[] = [];
  const editHref = `/agents/${input.id}/edit`;
  const detailHref = `/agents/${input.id}`;

  if (input.suspendedAt) {
    blockers.push({
      category: "suspended",
      title: "Resume or keep suspended",
      message:
        "The agent is suspended and its traffic is refused at the proxy. Resume it before approving, or leave it suspended and do not approve.",
      href: detailHref,
      soft: false,
    });
  }

  const charter = getCharterStatus(input);
  if (!charter.complete) {
    blockers.push({
      category: "charter",
      title: "Write the agent charter",
      message: `The charter is incomplete: ${charter.missing.join(", ")} not defined. Approval needs a stated purpose, the actions the agent may take, and the limits it must stay within.`,
      href: `${editHref}#charter`,
      soft: false,
    });
  } else if (charter.recommended.length > 0) {
    blockers.push({
      category: "charter",
      title: "Complete the optional charter fields",
      message: `Charter has no ${charter.recommended.join(" or ")}. Both make audits and incident reviews faster.`,
      href: `${editHref}#charter`,
      soft: true,
    });
  }

  const enforcing = input.mcpEnforcement === "enforce" && input.mcpServerAllowlist.length > 0;
  if (input.autonomyLevel === "FULL_AUTONOMY" && !enforcing) {
    blockers.push({
      category: "autonomy_controls",
      title: "Enforce the MCP allowlist",
      message:
        "FULL_AUTONOMY agents have no human to catch a bad tool call, so approval requires MCP enforcement set to Enforce with at least one allowed server.",
      href: `${editHref}#mcp`,
      soft: false,
    });
  } else if (input.autonomyLevel === "SUPERVISED" && !enforcing) {
    blockers.push({
      category: "autonomy_controls",
      title: "Consider enforcing the MCP allowlist",
      message:
        "SUPERVISED agents act before a human can intervene. Enforce mode with an allowlist limits what a bad step can reach.",
      href: `${editHref}#mcp`,
      soft: true,
    });
  }

  const humanLoop =
    input.autonomyLevel === "HUMAN_IN_THE_LOOP" || input.autonomyLevel === "HUMAN_ON_THE_LOOP";
  if (humanLoop && !input.humanReviewRequired) {
    blockers.push({
      category: "human_review",
      title: "Reconcile the human-review setting",
      message: `Autonomy is ${input.autonomyLevel.replace(/_/g, " ").toLowerCase()} but human review is marked not required. One of the two is wrong.`,
      href: editHref,
      soft: true,
    });
  } else if (input.humanReviewRequired && input.humanReviewTriggersCount === 0) {
    blockers.push({
      category: "human_review",
      title: "Declare human-review triggers",
      message:
        "Human review is required but no triggers are declared. State which tool calls or argument thresholds force a human step so the proxy can hold them.",
      href: `${editHref}#human-review`,
      soft: true,
    });
  } else if (input.humanReviewRequired && input.enforceableTriggersCount === 0) {
    blockers.push({
      category: "human_review",
      title: "Make the review triggers enforceable",
      message:
        "The human-review triggers are notes only. Rewrite them as tool or argument triggers so the proxy can evaluate them against real tool calls.",
      href: `${editHref}#human-review`,
      soft: true,
    });
  } else if (
    humanLoop &&
    input.enforceableTriggersCount > 0 &&
    input.humanReviewEnforcement !== "enforce"
  ) {
    blockers.push({
      category: "human_review",
      title: "Enforce the review triggers",
      message:
        "Review triggers are declared but only monitored: matching tool calls are recorded and alerted, not held. Switch human-review enforcement to Enforce so the proxy withholds them.",
      href: `${editHref}#human-review`,
      soft: true,
    });
  }

  const hasRiskBasis = input.parentRiskAssessmentsCount > 0 || input.riskReviewsCount > 0;
  if (!hasRiskBasis) {
    const high = HIGH_TIERS.has(input.riskLevel);
    blockers.push({
      category: "risk",
      title: high ? "Assess the risk" : "Record a risk review",
      message: input.aiSystemId
        ? high
          ? `${input.riskLevel} risk agent with no risk basis. Run a Risk Center assessment on the parent system (agents are scored as an overlay) or generate an agent risk review.`
          : "No risk basis yet. Assess the parent system in the Risk Center or generate an agent risk review."
        : high
          ? `${input.riskLevel} risk agent with no risk basis and no parent system. Generate an agent risk review, or link a parent system and assess it.`
          : "No risk basis yet. Generate an agent risk review on the detail page.",
      href: input.aiSystemId
        ? `/risk-center/assessments/new?systemId=${input.aiSystemId}`
        : `${detailHref}#risk`,
      soft: !high,
    });
  }

  if (!input.aiSystemId) {
    blockers.push({
      category: "parent_system",
      title: "Link a parent system",
      message:
        "No parent AI system. Linking one inherits its risk assessment and policies and attributes the agent's usage to it.",
      href: editHref,
      soft: true,
    });
  }

  const required = getAgentRequiredStages(input);
  const approved = getAgentApprovedStages(input.governanceReviews);
  const missingStages = required.filter((stage) => !approved.has(stage));
  if (missingStages.length > 0) {
    blockers.push({
      category: "stage_review",
      title: `Complete ${missingStages.map((s) => GOVERNANCE_STAGE_LABELS[s]).join(", ")} review`,
      message: `Missing required approval${missingStages.length > 1 ? "s" : ""}: ${missingStages
        .map((s) => GOVERNANCE_STAGE_LABELS[s])
        .join(", ")}.`,
      href: `${detailHref}#reviews`,
      soft: false,
    });
  }

  if (!input.nextReviewDate) {
    blockers.push({
      category: "review_date",
      title: "Set a review cadence",
      message: "No next-review date. Edit the agent to set a review interval; approval starts the clock.",
      href: editHref,
      soft: false,
    });
  } else if (isPast(input.nextReviewDate)) {
    blockers.push({
      category: "review_date",
      title: "Renew the governance review",
      message: "The next-review date has passed. Re-review the agent and record a fresh approval to restart the cadence.",
      href: `${detailHref}#approval`,
      soft: false,
    });
  }

  if (input.unapprovedToolProfiles > 0) {
    blockers.push({
      category: "mcp_unapproved",
      title: "Triage unapproved tools",
      message: `${input.unapprovedToolProfiles} observed MCP server${input.unapprovedToolProfiles === 1 ? " or tool is" : "s or tools are"} not on the allowlist. Approve or block each one so the allowlist reflects reality.`,
      href: `${detailHref}#mcp`,
      soft: true,
    });
  }

  return blockers;
}

export function isHardAgentBlocker(blocker: AgentApprovalBlocker): boolean {
  return !blocker.soft;
}

export function getAgentWorkflowSummary(
  input: AgentGovernanceInput,
  blockers: AgentApprovalBlocker[] = getAgentApprovalBlockers(input)
): AgentWorkflowSummary {
  const hard = blockers.filter(isHardAgentBlocker);
  const soft = blockers.filter((b) => b.soft);
  const detailHref = `/agents/${input.id}`;
  const toAction = (b: AgentApprovalBlocker): GovernanceAction => ({
    label: b.title,
    href: b.href ?? detailHref,
    tone: b.soft ? "info" : b.category === "suspended" || b.category === "review_date" ? "critical" : "warning",
  });
  const actions: GovernanceAction[] = [...hard.map(toAction), ...soft.map(toAction)];
  const approved = input.latestApprovalDecision === "APPROVED";

  if (input.latestApprovalDecision === "CHANGES_REQUESTED") {
    actions.unshift({ label: "Address requested changes", href: `${detailHref}#approval`, tone: "critical" });
    return {
      stage: "Changes Requested",
      readiness: "blocked",
      message: "Approval review identified follow-up work before this agent can be approved.",
      actions,
    };
  }
  if (input.latestApprovalDecision === "REVOKED") {
    actions.unshift({ label: "Re-open approval review", href: `${detailHref}#approval`, tone: "critical" });
    return {
      stage: "Approval Revoked",
      readiness: "blocked",
      message: "This agent's approval was revoked. Re-review it before it runs again.",
      actions,
    };
  }
  if (input.suspendedAt) {
    return {
      stage: "Suspended",
      readiness: "blocked",
      message: "The kill switch is on: the proxy refuses this agent's traffic until it is resumed.",
      actions,
    };
  }
  if (blockers.some((b) => b.category === "review_date" && !b.soft && input.nextReviewDate)) {
    return {
      stage: "Review Overdue",
      readiness: "blocked",
      message: "This agent has passed its scheduled review date and should be re-reviewed before continued operation.",
      actions,
    };
  }
  if (hard.length === 0 && approved && (input.status === "APPROVED" || input.status === "DEPLOYED")) {
    return {
      stage: "Monitored",
      readiness: "monitored",
      message: "Charter, controls and approvals are in place. The proxy governs its tools; watch the activity.",
      actions: [
        { label: "Review MCP activity and denials", href: "/oversight/mcp-activity", tone: "info" },
        ...soft.map(toAction),
      ],
    };
  }
  if (hard.length === 0) {
    if (!approved) {
      actions.unshift({ label: "Record approval decision", href: `${detailHref}#approval`, tone: "success" });
    }
    return {
      stage: input.status === "UNDER_REVIEW" ? "Approval Review" : "Ready",
      readiness: "ready",
      message: approved
        ? "Governance steps are complete and the agent has an approval record. Move it to DEPLOYED when it goes live."
        : "Charter, controls and stage reviews are complete. Record the approval decision.",
      actions,
    };
  }
  return {
    stage: input.status === "DRAFT" ? "Intake" : "In Progress",
    readiness: "in_progress",
    message: `${hard.length} item${hard.length === 1 ? "" : "s"} must be resolved before this agent can be approved.`,
    actions,
  };
}

export function getAgentChecklist(
  input: AgentGovernanceInput,
  blockers: AgentApprovalBlocker[] = getAgentApprovalBlockers(input)
): ChecklistItem[] {
  const has = (category: AgentBlockerCategory, hardOnly = false) =>
    blockers.some((b) => b.category === category && (!hardOnly || !b.soft));
  const charter = getCharterStatus(input);
  const required = getAgentRequiredStages(input);
  const approvedStages = getAgentApprovedStages(input.governanceReviews);
  const missingStages = required.filter((s) => !approvedStages.has(s));
  const editHref = `/agents/${input.id}/edit`;
  const detailHref = `/agents/${input.id}`;

  return [
    {
      id: "charter",
      label: "Write the agent charter",
      detail: charter.complete
        ? "Purpose, in-scope actions and decision boundaries are defined."
        : `Define the ${charter.missing.join(", ")}.`,
      done: charter.complete,
      href: `${editHref}#charter`,
    },
    {
      id: "parent",
      label: "Link the parent AI system",
      detail: input.aiSystemId
        ? "Risk and policy posture are inherited from the parent."
        : "Optional, but it inherits the system's risk assessment and policies.",
      done: Boolean(input.aiSystemId),
      href: editHref,
      optional: true,
    },
    {
      id: "controls",
      label: "Match controls to the autonomy level",
      detail: has("autonomy_controls", true)
        ? "Full autonomy requires Enforce mode with an MCP server allowlist."
        : has("human_review")
          ? "Human-review settings need attention."
          : "Autonomy, human review and MCP enforcement are consistent.",
      done: !has("autonomy_controls", true) && !has("human_review"),
      href: `${editHref}#mcp`,
    },
    {
      id: "risk",
      label: "Establish the risk basis",
      detail:
        input.parentRiskAssessmentsCount > 0
          ? "The parent system has a Risk Center assessment."
          : input.riskReviewsCount > 0
            ? "An agent risk review is on file."
            : "Assess the parent system or generate an agent risk review.",
      done: !has("risk"),
      href: input.aiSystemId ? `/risk-center/assessments/new?systemId=${input.aiSystemId}` : `${detailHref}#risk`,
    },
    {
      id: "stages",
      label: "Collect the required stage reviews",
      detail:
        required.length === 0
          ? "No stages required."
          : missingStages.length === 0
            ? `${required.map((s) => GOVERNANCE_STAGE_LABELS[s]).join(", ")} approved.`
            : `Waiting on ${missingStages.map((s) => GOVERNANCE_STAGE_LABELS[s]).join(", ")}.`,
      done: missingStages.length === 0,
      href: `${detailHref}#reviews`,
    },
    {
      id: "approval",
      label: "Record the approval decision",
      detail:
        input.latestApprovalDecision === "APPROVED"
          ? "Approved. Renewal is due on the next-review date."
          : "Final sign-off once the blockers above are clear.",
      done: input.latestApprovalDecision === "APPROVED",
      href: `${detailHref}#approval`,
    },
    {
      id: "attribution",
      label: "Route the agent's traffic through the proxy",
      detail: input.observedActivity
        ? "Traffic carrying this agent's x-agent-id has been observed."
        : "Send x-agent-id on its model calls so tools, denials and the kill switch apply.",
      done: input.observedActivity,
      href: `${detailHref}#mcp`,
      optional: true,
    },
  ];
}
