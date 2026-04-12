import { notFound } from "next/navigation";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AutonomyBadge } from "@/components/ui/autonomy-tooltip";
import { AgentAIRiskCard } from "@/components/agents/agent-ai-risk-card";

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = await prisma.aIAgent.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, email: true } },
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
    },
  });
  if (!agent) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={agent.name} description={agent.description ?? undefined}>
        <Link href={`/agents/${agent.id}/edit`}>
          <Button variant="outline">
            <Pencil className="mr-2 h-4 w-4" /> Edit
          </Button>
        </Link>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        <Badge variant={riskBadgeVariant(agent.riskLevel)}>Risk: {agent.riskLevel}</Badge>
        <Badge variant={statusBadgeVariant(agent.status)}>{agent.status.replace("_", " ")}</Badge>
        <AutonomyBadge level={agent.autonomyLevel} />
        {agent.humanReviewRequired && <Badge variant="info">HITL Required</Badge>}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
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
  );
}
