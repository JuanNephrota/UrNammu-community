/**
 * Prisma loader for agent governance. Produces the `AgentGovernanceInput`
 * that `agent-governance.ts` scores, plus the raw approval and stage-review
 * rows the detail page renders. Shared by the agent detail page and the
 * approval API so both see the same blockers.
 */
import { prisma } from "./prisma";
import { countHumanReviewTriggers, type AgentGovernanceInput } from "./agent-governance";

const decidedBy = { select: { name: true, email: true } } as const;

export async function loadAgentGovernance(agentId: string) {
  const agent = await prisma.aIAgent.findUnique({
    where: { id: agentId },
    include: {
      approvals: { orderBy: { createdAt: "desc" }, include: { decidedByUser: decidedBy } },
      governanceReviews: { orderBy: { createdAt: "desc" }, include: { decidedByUser: decidedBy } },
      aiSystem: { select: { id: true, name: true, _count: { select: { riskAssessments: true } } } },
      _count: { select: { riskReviews: true } },
    },
  });
  if (!agent) return null;

  const [unapprovedToolProfiles, observedProfiles] = await Promise.all([
    prisma.agentToolProfile.count({ where: { agentId, approved: false } }),
    prisma.agentToolProfile.count({ where: { agentId } }),
  ]);

  const input: AgentGovernanceInput = {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    riskLevel: agent.riskLevel,
    autonomyLevel: agent.autonomyLevel,
    humanReviewRequired: agent.humanReviewRequired,
    humanReviewTriggersCount: countHumanReviewTriggers(agent.humanReviewTriggers),
    purpose: agent.purpose,
    inScopeActions: agent.inScopeActions,
    outOfScopeActions: agent.outOfScopeActions,
    decisionBoundaries: agent.decisionBoundaries,
    successCriteria: agent.successCriteria,
    aiSystemId: agent.aiSystemId,
    parentRiskAssessmentsCount: agent.aiSystem?._count.riskAssessments ?? 0,
    riskReviewsCount: agent._count.riskReviews,
    mcpEnforcement: agent.mcpEnforcement,
    mcpServerAllowlist: agent.mcpServerAllowlist,
    mcpToolAllowlist: agent.mcpToolAllowlist,
    unapprovedToolProfiles,
    observedActivity: observedProfiles > 0,
    suspendedAt: agent.suspendedAt,
    requireOwnerApproval: agent.requireOwnerApproval,
    requireSecurityApproval: agent.requireSecurityApproval,
    requireLegalApproval: agent.requireLegalApproval,
    requireComplianceApproval: agent.requireComplianceApproval,
    governanceReviews: agent.governanceReviews.map((r) => ({ stage: r.stage, approved: r.approved })),
    latestApprovalDecision: agent.approvals[0]?.decision ?? null,
    nextReviewDate: agent.nextReviewDate,
  };

  return { agent, input };
}

export type LoadedAgentGovernance = NonNullable<Awaited<ReturnType<typeof loadAgentGovernance>>>;
