/**
 * Prisma loader for agent governance. Produces the `AgentGovernanceInput`
 * that `agent-governance.ts` scores, the `PostureInput` that
 * `agent-posture.ts` scores, plus the raw approval and stage-review rows the
 * detail page renders. Shared by the agent detail page, the approval API, the
 * registry list and the executive roll-up so every surface sees the same
 * blockers and the same posture.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { type AgentGovernanceInput, type AgentRetirementInput } from "./agent-governance";
import { computeAgentPosture, type AgentPosture, type PostureInput } from "./agent-posture";
import { isEnforceableTrigger, normalizeHumanReviewTriggers } from "./human-review-triggers";
import { mergeCatalogIntoConfig, normalizeEnforcement, type McpCatalogEntryLike } from "./mcp-tool-governance";
import { loadActiveCatalog } from "./mcp-tool-activity";

const decidedBy = { select: { name: true, email: true } } as const;

/** Everything the scorers need, in one query. */
const governanceInclude = {
  approvals: { orderBy: { createdAt: "desc" }, include: { decidedByUser: decidedBy } },
  governanceReviews: { orderBy: { createdAt: "desc" }, include: { decidedByUser: decidedBy } },
  aiSystem: { select: { id: true, name: true, _count: { select: { riskAssessments: true } } } },
  behaviorBaseline: true,
  // One row is enough to know traffic has ever been attributed.
  toolProfiles: { take: 1, select: { id: true } },
  _count: {
    select: {
      riskReviews: true,
      incidents: { where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } } },
      toolProfiles: { where: { approved: false } },
    },
  },
} satisfies Prisma.AIAgentInclude;

type AgentRow = Prisma.AIAgentGetPayload<{ include: typeof governanceInclude }>;

function buildGovernanceInput(agent: AgentRow, catalog: McpCatalogEntryLike[]): AgentGovernanceInput {
  const triggers = normalizeHumanReviewTriggers(agent.humanReviewTriggers);
  // What the proxies actually enforce: the agent's own allowlists plus the
  // org catalog when inherited.
  const effective = mergeCatalogIntoConfig(
    {
      serverAllowlist: agent.mcpServerAllowlist,
      toolAllowlist: agent.mcpToolAllowlist,
      enforcement: normalizeEnforcement(agent.mcpEnforcement),
    },
    agent.inheritMcpCatalog ? catalog : []
  );
  return {
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
    unapprovedToolProfiles: agent._count.toolProfiles,
    observedActivity: agent.toolProfiles.length > 0,
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
}

function buildPostureInput(agent: AgentRow, input: AgentGovernanceInput): PostureInput {
  const triggers = normalizeHumanReviewTriggers(agent.humanReviewTriggers);
  const baselineRow = agent.behaviorBaseline;
  return {
    ...input,
    connectedSystemsCount: Array.isArray(agent.connectedSystems) ? agent.connectedSystems.length : 0,
    toolArgumentTriggersCount: triggers.filter((t) => t.kind === "tool_argument").length,
    baseline: baselineRow
      ? {
          mature: baselineRow.activeDays >= 7,
          findingsCount: Array.isArray(baselineRow.lastFindings) ? baselineRow.lastFindings.length : 0,
        }
      : null,
  };
}

export async function loadAgentGovernance(agentId: string) {
  const agent = await prisma.aIAgent.findUnique({ where: { id: agentId }, include: governanceInclude });
  if (!agent) return null;

  const [recentCallsCount, catalog] = await Promise.all([
    prisma.agentToolCall.count({
      where: { agentId, createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
    }),
    agent.inheritMcpCatalog ? loadActiveCatalog() : Promise.resolve([]),
  ]);

  const input = buildGovernanceInput(agent, catalog);
  const posture = computeAgentPosture(buildPostureInput(agent, input));

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

  return { agent, input, posture, retirement, inheritedServers };
}

export type LoadedAgentGovernance = NonNullable<Awaited<ReturnType<typeof loadAgentGovernance>>>;

export type AgentPostureRow = {
  id: string;
  name: string;
  status: AgentRow["status"];
  riskLevel: AgentRow["riskLevel"];
  posture: AgentPosture;
};

/**
 * Posture for every agent (RETIRED excluded by default) in two queries, for
 * the registry list and the executive roll-up.
 */
export async function loadAgentPostures(options: { includeRetired?: boolean } = {}): Promise<AgentPostureRow[]> {
  const [agents, catalog] = await Promise.all([
    prisma.aIAgent.findMany({
      where: options.includeRetired ? undefined : { status: { not: "RETIRED" } },
      include: governanceInclude,
      orderBy: { name: "asc" },
    }),
    loadActiveCatalog(),
  ]);
  return agents.map((agent) => {
    const input = buildGovernanceInput(agent, catalog);
    return {
      id: agent.id,
      name: agent.name,
      status: agent.status,
      riskLevel: agent.riskLevel,
      posture: computeAgentPosture(buildPostureInput(agent, input)),
    };
  });
}
