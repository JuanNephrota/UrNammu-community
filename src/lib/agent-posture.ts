/**
 * Agent governance posture — the six governance-by-design dimensions from
 * IBM's agentic-AI governance playbook, scored per agent from what items 1–5
 * of docs/plans/agentic-governance-playbook.md record:
 *
 *   Ownership         Who owns outcomes across the lifecycle?
 *   Authority         How are authority limits enforced technically?
 *   Decision making   When should intervention occur?
 *   Control           What threshold limits apply?
 *   Boundaries        Within what parameters should the agent operate?
 *   Responsibilities  Division between business, technology and risk roles.
 *
 * Pure: takes the same `AgentGovernanceInput` the approval blockers use plus
 * a few counts, returns 0–100 per dimension with evidence and gaps. The
 * score is descriptive, not a gate; the approval gate stays the gate.
 */

import {
  getAgentApprovedStages,
  getAgentRequiredStages,
  getCharterStatus,
  type AgentGovernanceInput,
} from "./agent-governance";

export type PostureInput = AgentGovernanceInput & {
  connectedSystemsCount: number;
  /** `tool_argument` triggers: real thresholds, not just "any call". */
  toolArgumentTriggersCount: number;
  baseline: { mature: boolean; findingsCount: number } | null;
};

export type PostureDimensionKey =
  | "ownership"
  | "authority"
  | "decision_making"
  | "control"
  | "boundaries"
  | "responsibilities";

export type PostureGap = { text: string; href: string };

export type PostureDimension = {
  key: PostureDimensionKey;
  label: string;
  question: string;
  score: number;
  status: "strong" | "partial" | "weak";
  evidence: string[];
  gaps: PostureGap[];
};

export type PostureTier = "strong" | "developing" | "weak";

export type AgentPosture = {
  overall: number;
  tier: PostureTier;
  dimensions: PostureDimension[];
  /** The dimension with the lowest score. */
  weakest: PostureDimension;
};

export const POSTURE_DIMENSIONS: Array<{ key: PostureDimensionKey; label: string; question: string }> = [
  { key: "ownership", label: "Ownership", question: "Who owns outcomes across the lifecycle?" },
  { key: "authority", label: "Authority", question: "How are authority limits enforced technically?" },
  { key: "decision_making", label: "Decision making", question: "When should a person intervene?" },
  { key: "control", label: "Control", question: "What threshold limits apply?" },
  { key: "boundaries", label: "Boundaries", question: "Within what parameters does it operate?" },
  { key: "responsibilities", label: "Responsibilities", question: "How are business, technology and risk roles divided?" },
];

const HIGH_TIERS = new Set(["HIGH", "CRITICAL"]);

type Check = { points: number; ok: boolean | number; evidence: string; gap: string; href: string };

function scoreChecks(checks: Check[]): { score: number; evidence: string[]; gaps: PostureGap[] } {
  let score = 0;
  const evidence: string[] = [];
  const gaps: PostureGap[] = [];
  for (const c of checks) {
    const fraction = typeof c.ok === "number" ? Math.max(0, Math.min(1, c.ok)) : c.ok ? 1 : 0;
    score += c.points * fraction;
    if (fraction >= 1) evidence.push(c.evidence);
    else gaps.push({ text: c.gap, href: c.href });
  }
  return { score: Math.round(score), evidence, gaps };
}

function statusOf(score: number): PostureDimension["status"] {
  return score >= 80 ? "strong" : score >= 50 ? "partial" : "weak";
}

export function tierOf(overall: number): PostureTier {
  return overall >= 80 ? "strong" : overall >= 55 ? "developing" : "weak";
}

export function computeAgentPosture(input: PostureInput): AgentPosture {
  const edit = `/agents/${input.id}/edit`;
  const detail = `/agents/${input.id}`;
  const charter = getCharterStatus(input);
  const required = getAgentRequiredStages(input);
  const approvedStages = getAgentApprovedStages(input.governanceReviews);
  const stagesDone = required.filter((s) => approvedStages.has(s)).length;
  const humanLoop = input.autonomyLevel === "HUMAN_IN_THE_LOOP" || input.autonomyLevel === "HUMAN_ON_THE_LOOP";
  const autonomous = input.autonomyLevel === "FULL_AUTONOMY" || input.autonomyLevel === "SUPERVISED";
  const reviewConsistent = !(humanLoop && !input.humanReviewRequired);
  const reviewCurrent = !!input.nextReviewDate && new Date(input.nextReviewDate).getTime() >= Date.now();
  const hasRiskBasis = input.parentRiskAssessmentsCount > 0 || input.riskReviewsCount > 0;
  const allowlisted = input.mcpServerAllowlist.length > 0;
  const enforcedTriggers = input.enforceableTriggersCount > 0 && input.humanReviewEnforcement === "enforce";

  const byKey: Record<PostureDimensionKey, Check[]> = {
    ownership: [
      { points: 25, ok: true, evidence: "Business owner recorded", gap: "", href: edit },
      { points: 25, ok: !!input.technicalOwnerId, evidence: "Technical owner named", gap: "Name a technical owner", href: `${edit}#accountability` },
      { points: 25, ok: !!input.riskOwnerId, evidence: "Risk owner named", gap: HIGH_TIERS.has(input.riskLevel) ? "Name a risk owner (HIGH/CRITICAL agent)" : "Name a risk owner", href: `${edit}#accountability` },
      { points: 25, ok: !!input.escalationContact, evidence: "Escalation contact set", gap: autonomous ? "Set an escalation contact (agent acts without a human in the loop)" : "Set an escalation contact", href: `${edit}#accountability` },
    ],
    authority: [
      { points: 30, ok: allowlisted, evidence: `MCP server allowlist in force (${input.mcpServerAllowlist.length})`, gap: "Allowlist the MCP servers it may use, or inherit the org catalog", href: `${edit}#mcp` },
      { points: 20, ok: input.mcpEnforcement === "enforce", evidence: "MCP allowlist enforced at the proxy", gap: "Switch MCP enforcement from Monitor to Enforce", href: `${edit}#mcp` },
      { points: 25, ok: input.enforceableTriggersCount > 0, evidence: `${input.enforceableTriggersCount} enforceable review trigger${input.enforceableTriggersCount === 1 ? "" : "s"}`, gap: "Declare tool or argument triggers the proxy can evaluate", href: `${edit}#human-review` },
      { points: 25, ok: enforcedTriggers, evidence: "Review triggers withhold matching calls", gap: input.enforceableTriggersCount > 0 ? "Switch human-review enforcement to Enforce" : "Enforce review triggers once declared", href: `${edit}#human-review` },
    ],
    decision_making: [
      { points: 30, ok: reviewConsistent, evidence: `Human review setting matches ${input.autonomyLevel.replace(/_/g, " ").toLowerCase()}`, gap: "Human review is marked not required for a human-in/on-the-loop agent", href: edit },
      { points: 30, ok: input.humanReviewTriggersCount > 0, evidence: `${input.humanReviewTriggersCount} human-review trigger${input.humanReviewTriggersCount === 1 ? "" : "s"} declared`, gap: "State the conditions that force a human step", href: `${edit}#human-review` },
      { points: 20, ok: input.openIncidentsCount === 0, evidence: "No open incidents", gap: `${input.openIncidentsCount} open incident${input.openIncidentsCount === 1 ? "" : "s"} to resolve`, href: `${detail}#incidents` },
      { points: 10, ok: !!input.baseline?.mature, evidence: "Behaviour baseline mature", gap: "Baseline still learning (needs 7 active days of attributed traffic)", href: `${detail}#baseline` },
      { points: 10, ok: !!input.baseline?.mature && input.baseline.findingsCount === 0, evidence: "No drift in the last 24 hours", gap: input.baseline?.mature ? `${input.baseline.findingsCount} drift finding${input.baseline.findingsCount === 1 ? "" : "s"} to review` : "Drift detection starts once the baseline is mature", href: `${detail}#baseline` },
    ],
    control: [
      { points: 35, ok: input.toolArgumentTriggersCount > 0, evidence: `${input.toolArgumentTriggersCount} argument threshold${input.toolArgumentTriggersCount === 1 ? "" : "s"} (amounts, data classes, paths)`, gap: "Add argument-level thresholds (e.g. amount > 1000) rather than tool-only triggers", href: `${edit}#human-review` },
      { points: 30, ok: !!input.baseline?.mature, evidence: "Volume, model, caller and hours baselined", gap: "Route traffic through the proxy with x-agent-id so a baseline can form", href: `${detail}#baseline` },
      { points: 35, ok: reviewCurrent, evidence: "Review cadence set and current", gap: input.nextReviewDate ? "Review date has passed; re-review and re-approve" : "Set a review interval", href: input.nextReviewDate ? `${detail}#approval` : edit },
    ],
    boundaries: [
      { points: 50, ok: (3 - charter.missing.length) / 3, evidence: "Purpose, in-scope actions and decision boundaries defined", gap: `Charter missing: ${charter.missing.join(", ")}`, href: `${edit}#charter` },
      { points: 10, ok: input.outOfScopeActions.length > 0, evidence: "Out-of-scope actions listed", gap: "List what the agent must never do", href: `${edit}#charter` },
      { points: 10, ok: !!input.successCriteria?.trim(), evidence: "Success criteria stated", gap: "State how you will know it works and when to retire it", href: `${edit}#charter` },
      { points: 15, ok: !!input.aiSystemId, evidence: "Parent AI system linked", gap: "Link the parent AI system", href: edit },
      { points: 15, ok: input.connectedSystemsCount > 0, evidence: `${input.connectedSystemsCount} connected system${input.connectedSystemsCount === 1 ? "" : "s"} documented`, gap: "Document the systems it reaches (blast radius)", href: edit },
    ],
    responsibilities: [
      { points: 40, ok: input.latestApprovalDecision === "APPROVED", evidence: "Approval on record", gap: input.latestApprovalDecision ? `Latest decision: ${input.latestApprovalDecision.replace(/_/g, " ").toLowerCase()}` : "No approval decision recorded", href: `${detail}#approval` },
      { points: 30, ok: required.length === 0 ? 1 : stagesDone / required.length, evidence: required.length === 0 ? "No stage reviews required" : `${required.length} stage review${required.length === 1 ? "" : "s"} approved`, gap: `${required.length - stagesDone} of ${required.length} stage reviews outstanding`, href: `${detail}#reviews` },
      { points: 30, ok: hasRiskBasis, evidence: input.parentRiskAssessmentsCount > 0 ? "Parent system risk-assessed" : "Agent risk review on file", gap: "Assess the parent system or generate an agent risk review", href: `${detail}#risk` },
    ],
  };

  const dimensions: PostureDimension[] = POSTURE_DIMENSIONS.map((d) => {
    const { score, evidence, gaps } = scoreChecks(byKey[d.key]);
    return { ...d, score, status: statusOf(score), evidence, gaps };
  });
  const overall = Math.round(dimensions.reduce((a, d) => a + d.score, 0) / dimensions.length);
  const weakest = dimensions.reduce((min, d) => (d.score < min.score ? d : min), dimensions[0]);
  return { overall, tier: tierOf(overall), dimensions, weakest };
}

/** Portfolio roll-up for the executive view. */
export type PosturePortfolio = {
  agents: number;
  average: number;
  tiers: Record<PostureTier, number>;
  /** Average per dimension, ascending (weakest first). */
  dimensions: Array<{ key: PostureDimensionKey; label: string; average: number }>;
  /** Lowest-scoring agents, ascending. */
  weakestAgents: Array<{ id: string; name: string; overall: number; tier: PostureTier; weakest: string }>;
};

export function summarizePostures(
  rows: Array<{ id: string; name: string; posture: AgentPosture }>,
  limit = 5
): PosturePortfolio {
  const tiers: Record<PostureTier, number> = { strong: 0, developing: 0, weak: 0 };
  for (const r of rows) tiers[r.posture.tier] += 1;
  const dimensions = POSTURE_DIMENSIONS.map((d) => ({
    key: d.key,
    label: d.label,
    average:
      rows.length === 0
        ? 0
        : Math.round(rows.reduce((a, r) => a + (r.posture.dimensions.find((x) => x.key === d.key)?.score ?? 0), 0) / rows.length),
  })).sort((a, b) => a.average - b.average);
  return {
    agents: rows.length,
    average: rows.length === 0 ? 0 : Math.round(rows.reduce((a, r) => a + r.posture.overall, 0) / rows.length),
    tiers,
    dimensions,
    weakestAgents: [...rows]
      .sort((a, b) => a.posture.overall - b.posture.overall)
      .slice(0, limit)
      .map((r) => ({ id: r.id, name: r.name, overall: r.posture.overall, tier: r.posture.tier, weakest: r.posture.weakest.label })),
  };
}
