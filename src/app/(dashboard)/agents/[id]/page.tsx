import { notFound } from "next/navigation";
import Link from "next/link";
import { OctagonX, Pencil } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { formatDateTime } from "@/lib/utils";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AutonomyBadge } from "@/components/ui/autonomy-tooltip";
import { AgentAIRiskCard } from "@/components/agents/agent-ai-risk-card";
import { McpGovernanceCard } from "@/components/agents/mcp-governance-card";
import { AgentKillSwitch } from "@/components/agents/agent-kill-switch";
import { AgentCharterCard } from "@/components/agents/agent-charter-card";
import { HumanReviewCard, type HumanReviewMatchRow } from "@/components/agents/human-review-card";
import { AgentAccountabilityCard } from "@/components/agents/agent-accountability-card";
import { AgentRetireDialog } from "@/components/agents/agent-retire-dialog";
import { GovernanceIncidentsCard } from "@/components/registry/governance-incidents-card";
import { AgentBaselineCard } from "@/components/agents/agent-baseline-card";
import { AgentPostureCard } from "@/components/agents/agent-posture-card";
import type { AgentBaselineStats, DriftFinding } from "@/lib/agent-baseline";
import {
  HUMAN_REVIEW_RULE,
  normalizeHumanReviewTriggers,
  normalizeReviewEnforcement,
} from "@/lib/human-review-triggers";
import { ApprovalDecisionCard } from "@/components/registry/approval-decision-card";
import { GovernanceStageReviewCard } from "@/components/registry/governance-stage-review-card";
import { ChecklistCard } from "@/components/workflow/checklist-card";
import { WorkflowSummaryCard } from "@/components/workflow/workflow-summary-card";
import { loadAgentGovernance } from "@/lib/agent-governance-data";
import {
  getAgentApprovalBlockers,
  getAgentChecklist,
  getAgentRequiredStages,
  getAgentRetirementChecklist,
  getAgentWorkflowSummary,
} from "@/lib/agent-governance";

function daysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  const canOperate = session?.user.role === "ADMIN" || session?.user.role === "COMPLIANCE_OFFICER";
  const agent = await prisma.aIAgent.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, email: true } },
      suspendedBy: { select: { name: true, email: true } },
      technicalOwner: { select: { name: true, email: true } },
      riskOwner: { select: { name: true, email: true } },
      retiredBy: { select: { name: true, email: true } },
      aiSystem: {
        select: {
          id: true,
          name: true,
          riskLevel: true,
          useCase: true,
          dataSensitivity: true,
          vendor: true,
          modelType: true,
        },
      },
      riskReviews: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
  if (!agent) notFound();

  const governance = await loadAgentGovernance(agent.id);
  if (!governance) notFound();
  const blockers = getAgentApprovalBlockers(governance.input);
  const workflow = getAgentWorkflowSummary(governance.input, blockers);
  const checklist = getAgentChecklist(governance.input, blockers);
  const governanceReady = workflow.readiness === "ready" || workflow.readiness === "monitored";
  const requiredStages = getAgentRequiredStages(governance.input);
  const retirementChecklist = getAgentRetirementChecklist(governance.retirement);
  const baselineRow = governance.agent.behaviorBaseline;
  const baseline = baselineRow
    ? {
        stats: baselineRow.stats as unknown as AgentBaselineStats,
        activeDays: baselineRow.activeDays,
        computedAt: baselineRow.computedAt,
        lastEvaluatedAt: baselineRow.lastEvaluatedAt,
        findings: (Array.isArray(baselineRow.lastFindings) ? baselineRow.lastFindings : []) as unknown as DriftFinding[],
      }
    : null;
  const showRetirement = agent.status === "RETIRED" || agent.status === "DEPRECATED" || Boolean(agent.retiredAt);
  const incidents = await prisma.governanceIncident.findMany({
    where: { agentId: agent.id },
    orderBy: { openedAt: "desc" },
    take: 20,
    include: { openedByUser: { select: { name: true, email: true } } },
  });
  const reviewTriggers = normalizeHumanReviewTriggers(agent.humanReviewTriggers);
  const reviewEnforcement = normalizeReviewEnforcement(agent.humanReviewEnforcement);
  const pendingReviews = await prisma.humanReviewRequest.count({ where: { agentId: agent.id, status: "PENDING" } });
  const reviewDenials = await prisma.policyDenial.findMany({
    where: {
      requestMetadata: { path: ["agentId"], equals: agent.id },
      reasons: { array_contains: [{ ruleKey: HUMAN_REVIEW_RULE }] },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
    select: { id: true, createdAt: true, provider: true, model: true, mode: true, requestMetadata: true },
  });
  const recentReviewMatches: HumanReviewMatchRow[] = reviewDenials.map((row) => {
    const meta = (row.requestMetadata ?? {}) as { matches?: Array<{ trigger: string; tool: string; detail: string }> };
    return {
      id: row.id,
      createdAt: row.createdAt,
      provider: row.provider,
      model: row.model,
      mode: row.mode,
      matches: Array.isArray(meta.matches) ? meta.matches : [],
    };
  });

  const since30d = daysAgo(30);
  const [toolProfiles, calls30d, unapproved30d, lastCall] = await Promise.all([
    prisma.agentToolProfile.findMany({
      where: { agentId: agent.id },
      orderBy: [{ approved: "asc" }, { lastSeenAt: "desc" }],
      take: 100,
    }),
    prisma.agentToolCall.count({ where: { agentId: agent.id, createdAt: { gte: since30d } } }),
    prisma.agentToolCall.count({ where: { agentId: agent.id, createdAt: { gte: since30d }, approved: false } }),
    prisma.agentToolCall.findFirst({
      where: { agentId: agent.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title={agent.name} description={agent.description ?? undefined}>
        {canOperate && (
          <AgentKillSwitch agentId={agent.id} agentName={agent.name} suspended={!!agent.suspendedAt} />
        )}
        {canOperate && (
          <AgentRetireDialog
            agentId={agent.id}
            agentName={agent.name}
            retired={agent.status === "RETIRED"}
            attested={agent.retirementAttested}
          />
        )}
        <Link href={`/agents/${agent.id}/edit`}>
          <Button variant="outline">
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </Button>
        </Link>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        <Badge variant={riskBadgeVariant(agent.riskLevel)}>Risk: {agent.riskLevel}</Badge>
        <Badge variant={statusBadgeVariant(agent.status)}>{agent.status.replace("_", " ")}</Badge>
        {agent.suspendedAt && <Badge variant="critical">SUSPENDED</Badge>}
        <AutonomyBadge level={agent.autonomyLevel} />
        {agent.humanReviewRequired && <Badge variant="info">HITL Required</Badge>}
      </div>

      {(agent.suspendedAt || agent.status === "RETIRED") && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-[var(--critical-border)] bg-[var(--critical-dim)] px-4 py-3 text-sm"
        >
          <OctagonX className="mt-0.5 h-4 w-4 shrink-0 text-[var(--critical)]" />
          <div className="space-y-1">
            <p className="font-medium text-[var(--critical-strong)]">
              Traffic blocked at the proxy
              {agent.suspendedAt ? " — agent suspended" : " — agent retired"}
            </p>
            <p className="text-[var(--text-secondary)]">
              {agent.suspendedAt ? (
                <>
                  Suspended {formatDateTime(agent.suspendedAt)}
                  {agent.suspendedBy ? ` by ${agent.suspendedBy.name ?? agent.suspendedBy.email}` : ""}.{" "}
                  {agent.suspendedReason ? <>Reason: {agent.suspendedReason} </> : null}
                  Every request carrying <code className="text-xs">x-agent-id: {agent.id}</code> is refused with 403 and
                  recorded under{" "}
                  <Link href="/compliance/denials" className="text-[var(--accent)] hover:underline">
                    Compliance → Denials
                  </Link>
                  . Use <strong>Resume</strong> to allow traffic again.
                </>
              ) : (
                <>
                  {agent.retiredAt
                    ? `Retired ${formatDateTime(agent.retiredAt)}${agent.retiredBy ? ` by ${agent.retiredBy.name ?? agent.retiredBy.email}` : ""}${agent.retirementAttested ? "; disposal attested" : "; disposal not yet attested"}. `
                    : ""}
                  Retired agents cannot send traffic through the proxy. Every request carrying{" "}
                  <code className="text-xs">x-agent-id: {agent.id}</code> is refused with 403 and recorded under{" "}
                  <Link href="/compliance/denials" className="text-[var(--accent)] hover:underline">
                    Compliance → Denials
                  </Link>
                  . Change the status on the edit page to allow requests again.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      <ChecklistCard
        title="Governance checklist"
        description="Everything this agent needs before it is approved and monitored. Each open item links to where you complete it."
        items={checklist}
        readOnly={!canOperate}
        completeMessage="This agent is chartered, controlled, reviewed and approved."
        twoColumn
      />

      {showRetirement && (
        <ChecklistCard
          title="Retirement checklist"
          description="Controlled shutdown: stop the traffic, prove it stopped, close what is open, revoke the approval, attest disposal, record it."
          items={retirementChecklist}
          readOnly={!canOperate}
          completeMessage="This agent is fully retired: traffic refused, approval revoked, disposal attested and recorded."
          twoColumn
        />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <AgentPostureCard posture={governance.posture} className="lg:col-span-2" />
        <WorkflowSummaryCard workflow={workflow} status={agent.status} className="lg:col-span-2" />
        <div className="lg:col-span-2">
          <AgentCharterCard agent={agent} canEdit={canOperate} />
        </div>
        <div className="lg:col-span-2">
          <HumanReviewCard
            agent={{ id: agent.id, humanReviewRequired: agent.humanReviewRequired, autonomyLevel: agent.autonomyLevel }}
            triggers={reviewTriggers}
            enforcement={reviewEnforcement}
            recentMatches={recentReviewMatches}
            canEdit={canOperate}
            pendingReviews={pendingReviews}
          />
        </div>
        <AgentAccountabilityCard
          agent={{
            id: agent.id,
            owner: agent.owner,
            technicalOwner: agent.technicalOwner,
            riskOwner: agent.riskOwner,
            escalationContact: agent.escalationContact,
            riskLevel: agent.riskLevel,
          }}
          canEdit={canOperate}
        />
        <div id="incidents" className="scroll-mt-6 [&>*]:h-full">
          <GovernanceIncidentsCard
            systemId={agent.id}
            endpoint={`/api/agents/${agent.id}/incidents`}
            subjectNoun="agent"
            incidents={incidents}
          />
        </div>
        <div id="approval" className="scroll-mt-6 [&>*]:h-full">
          <ApprovalDecisionCard
            systemId={agent.id}
            endpoint={`/api/agents/${agent.id}/approval`}
            subjectNoun="agent"
            latestDecision={governance.agent.approvals[0]?.decision ?? null}
            governanceReady={governanceReady}
            approvals={governance.agent.approvals}
            blockers={blockers.map(({ message, href, category, soft }) => ({ message, href, category, soft }))}
          />
        </div>
        <div id="reviews" className="scroll-mt-6 [&>*]:h-full">
          <GovernanceStageReviewCard
            systemId={agent.id}
            endpoint={`/api/agents/${agent.id}/governance-review`}
            requiredStages={requiredStages}
            reviews={governance.agent.governanceReviews}
          />
        </div>
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--text-muted)]">Owner</dt>
                <dd className="font-medium">{agent.owner.name}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--text-muted)]">Access Level</dt>
                <dd className="font-medium">{agent.accessLevel}</dd>
              </div>
              {agent.aiSystem && (
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Parent System</dt>
                  <dd>
                    <Link href={`/registry/${agent.aiSystem.id}`} className="font-medium text-[var(--accent)] hover:underline">
                      {agent.aiSystem.name}
                    </Link>
                  </dd>
                </div>
              )}
              {agent.department && (
                <div className="flex justify-between">
                  <dt className="text-[var(--text-muted)]">Department</dt>
                  <dd className="font-medium">{agent.department}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Capabilities</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {(agent.capabilities as string[]).length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No capabilities defined.</p>
              ) : (
                (agent.capabilities as string[]).map((cap) => (
                  <span key={cap} className="rounded-full bg-[var(--accent-dim)] px-3 py-1 text-xs font-medium text-[var(--accent)]">
                    {cap}
                  </span>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Connected Systems</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {(agent.connectedSystems as string[]).length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No connected systems.</p>
              ) : (
                (agent.connectedSystems as string[]).map((sys) => (
                  <span key={sys} className="rounded-full bg-[var(--bg-elevated)] px-3 py-1 text-xs font-medium text-[var(--text-primary)]">
                    {sys}
                  </span>
                ))
              )}
            </div>
          </CardContent>
        </Card>
        <div className="lg:col-span-2">
          <AgentBaselineCard agentId={agent.id} baseline={baseline} canOperate={canOperate} />
        </div>
        <div id="mcp" className="scroll-mt-6 lg:col-span-2">
        <McpGovernanceCard
          agent={{
            id: agent.id,
            name: agent.name,
            mcpServerAllowlist: agent.mcpServerAllowlist,
            mcpToolAllowlist: agent.mcpToolAllowlist,
            mcpEnforcement: agent.mcpEnforcement,
            accessLevel: agent.accessLevel,
            connectedSystems: agent.connectedSystems as string[],
            capabilities: agent.capabilities as string[],
            aiSystem: agent.aiSystem ? { id: agent.aiSystem.id, name: agent.aiSystem.name } : null,
            inheritedServers: governance.inheritedServers,
          }}
          profiles={toolProfiles}
          stats={{ calls30d, unapproved30d, lastCallAt: lastCall?.createdAt ?? null }}
        />
        </div>
        <div id="risk" className="scroll-mt-6 lg:col-span-2">
        <AgentAIRiskCard
          agent={{
            id: agent.id,
            name: agent.name,
            description: agent.description,
            autonomyLevel: agent.autonomyLevel,
            humanReviewRequired: agent.humanReviewRequired,
            humanReviewTriggers: agent.humanReviewTriggers,
            connectedSystems: agent.connectedSystems,
            capabilities: agent.capabilities,
            accessLevel: agent.accessLevel,
            department: agent.department,
            riskLevel: agent.riskLevel,
            aiSystemId: agent.aiSystemId,
          }}
          initialReview={
            agent.riskReviews[0]
              ? {
                  id: agent.riskReviews[0].id,
                  recommendedRiskLevel: agent.riskReviews[0].recommendedRiskLevel,
                  reviewNeeded: agent.riskReviews[0].reviewNeeded,
                  summary: agent.riskReviews[0].summary,
                  concerns: Array.isArray(agent.riskReviews[0].concerns)
                    ? (agent.riskReviews[0].concerns as string[])
                    : [],
                  recommendations: Array.isArray(agent.riskReviews[0].recommendations)
                    ? (agent.riskReviews[0].recommendations as string[])
                    : [],
                  scores:
                    typeof agent.riskReviews[0].scores === "object" && agent.riskReviews[0].scores
                      ? (agent.riskReviews[0].scores as {
                          autonomy: number;
                          oversight: number;
                          blastRadius: number;
                          changeRisk: number;
                        })
                      : {
                          autonomy: 0,
                          oversight: 0,
                          blastRadius: 0,
                          changeRisk: 0,
                        },
                  createdAt: agent.riskReviews[0].createdAt.toISOString(),
                  generatedBy: agent.riskReviews[0].generatedBy,
                }
              : null
          }
          parentSystem={
            agent.aiSystem
              ? {
                  name: agent.aiSystem.name,
                  riskLevel: agent.aiSystem.riskLevel,
                  useCase: agent.aiSystem.useCase,
                  dataSensitivity: agent.aiSystem.dataSensitivity,
                  vendor: agent.aiSystem.vendor,
                  modelType: agent.aiSystem.modelType,
                }
              : null
          }
        />
        </div>
      </div>
    </div>
  );
}
