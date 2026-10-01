/**
 * Prisma loader for agent governance. Produces the `AgentGovernanceInput`
 * that `agent-governance.ts` scores, plus the raw approval and stage-review
 * rows the detail page renders. Shared by the agent detail page and the
 * approval API so both see the same blockers.
 */
import { prisma } from "./prisma";
import { type AgentGovernanceInput, type AgentRetirementInput } from "./agent-governance";
import { isEnforceableTrigger, normalizeHumanReviewTriggers } from "./human-review-triggers";
import { mergeCatalogIntoConfig, normalizeEnforcement } from "./mcp-tool-governance";
import { loadActiveCatalog } from "./mcp-tool-activity";

const decidedBy = { select: { name: true, email: true } } as const;

export async function loadAgentGovernance(agentId: string) {
  const agent = await prisma.aIAgent.findUnique({
    where: { id: agentId },
    include: {
      approvals: { orderBy: { createdAt: "desc" }, include: { decidedByUser: decidedBy } },
      governanceReviews: { orderBy: { createdAt: "desc" }, include: { decidedByUser: decidedBy } },
      aiSystem: { select: { id: true, name: true, _count: { select: { riskAssessments: true } } } },
      behaviorBaseline: true,
      _count: {
        select: {
          riskReviews: true,
          incidents: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } },
        },
      },
    },
  });
  if (!agent) return null;
  const triggers = normalizeHumanReviewTriggers(agent.humanReviewTriggers);

  const [unapprovedToolProfiles, observedProfiles, recentCallsCount, catalog] = await Promise.all([
    prisma.agentToolProfile.count({ where: { agentId, approved: false } }),
    prisma.agentToolProfile.count({ where: { agentId } }),
    prisma.agentToolCall.count({
      where: { agentId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
    agent.inheritMcpCatalog ? loadActiveCatalog() : Promise.resolve([]),
  ]);
  // What the proxies actually enforce: the agent's own allowlists plus the
  // org catalog when inherited.
  const effective = mergeCatalogIntoConfig(
    {
      serverAllowlist: agent.mcpServerAllowlist,
      toolAllowlist: agent.mcpToolAllowlist,
      enforcement: normalizeEnforcement(agent.mcpEnforcement),
    },
    catalog
  );

  const input: AgentGovernanceInput = {
    id: agent.id,
    name: agent.name,
    status: agent.status,
    riskLevel: agent.riskLevel,
    autonomyLevel: agent.autonomyLevel,
    humanReviewRequired: agent.humanReviewRequired,
    humanReviewTriggersCount: triggers.length,
    enforceableTriggersCount: triggers.filter(isEnforceableTrigger).length,
    humanReviewEnforcement: agent.humanReviewEnforcement,
    purpose: agent.purpose,
    inScopeActions: agent.inScopeActions,
    outOfScopeActions: agent.outOfScopeActions,
    decisionBoundaries: agent.decisionBoundaries,
    successCriteria: agent.successCriteria,
    aiSystemId: agent.aiSystemId,
    parentRiskAssessmentsCount: agent.aiSystem?._count.riskAssessments ?? 0,
    riskReviewsCount: agent._count.riskReviews,
    mcpEnforcement: agent.mcpEnforcement,
    mcpServerAllowlist: effective.serverAllowlist,
    mcpToolAllowlist: effective.toolAllowlist,
    unapprovedToolProfiles,
    observedActivity: observedProfiles > 0,
    suspendedAt: agent.suspendedAt,
    technicalOwnerId: agent.technicalOwnerId,
    riskOwnerId: agent.riskOwnerId,
    escalationContact: agent.escalationContact,
    openIncidentsCount: agent._count.incidents,
    requireOwnerApproval: agent.requireOwnerApproval,
    requireSecurityApproval: agent.requireSecurityApproval,
    requireLegalApproval: agent.requireLegalApproval,
    requireComplianceApproval: agent.requireComplianceApproval,
    governanceReviews: agent.governanceReviews.map((r) => ({ stage: r.stage, approved: r.approved })),
    latestApprovalDecision: agent.approvals[0]?.decision ?? null,
    nextReviewDate: agent.nextReviewDate,
  };

  const retirement: AgentRetirementInput = {
    id: agent.id,
    status: agent.status,
    suspendedAt: agent.suspendedAt,
    retiredAt: agent.retiredAt,
    retirementAttested: agent.retirementAttested,
    latestApprovalDecision: input.latestApprovalDecision,
    openIncidentsCount: agent._count.incidents,
    recentCallsCount,
  };

  const inheritedServers = catalog.map((c) => c.server).filter((s) => !agent.mcpServerAllowlist.includes(s));

  return { agent, input, retirement, inheritedServers };
}

export type LoadedAgentGovernance = NonNullable<Awaited<ReturnType<typeof loadAgentGovernance>>>;
