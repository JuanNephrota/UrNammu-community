import Link from "next/link";
import { Plus, Bot } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

export default async function AgentsPage() {
  const agents = await prisma.aIAgent.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { name: true } },
      aiSystem: { select: { id: true, name: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI Agent Registry"
        description="Track autonomous agents, capabilities, and human oversight requirements"
      >
        <Link href="/agents/new">
          <Button className="bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110">
            <Plus className="mr-2 h-4 w-4" /> Register Agent
          </Button>
        </Link>
      </PageHeader>

      {agents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Bot className="h-12 w-12 text-[var(--text-faint)] mb-4" />
            <p className="text-[var(--text-muted)]">No agents registered yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Link key={agent.id} href={`/agents/${agent.id}`}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-[var(--text-primary)]">{agent.name}</h3>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5">
                        {agent.owner.name} {agent.department ? `· ${agent.department}` : ""}
                      </p>
                    </div>
                    <Badge variant={riskBadgeVariant(agent.riskLevel)}>
                      {agent.riskLevel}
                    </Badge>
                  </div>
                  {agent.description && (
                    <p className="text-sm text-[var(--text-secondary)] line-clamp-2">{agent.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant={statusBadgeVariant(agent.status)}>
                      {agent.status.replace("_", " ")}
                    </Badge>
                    <Badge variant="outline">
                      {agent.autonomyLevel.replace(/_/g, " ")}
                    </Badge>
                    {agent.humanReviewRequired && (
                      <Badge variant="info">HITL</Badge>
                    )}
                  </div>
                  {agent.aiSystem && (
                    <p className="text-xs text-[var(--text-faint)]">
                      System: {agent.aiSystem.name}
                    </p>
                  )}
                  <div className="flex gap-1 flex-wrap">
                    {(agent.capabilities as string[]).slice(0, 3).map((cap) => (
                      <span key={cap} className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[10px] text-[var(--text-secondary)]">
                        {cap}
                      </span>
                    ))}
                    {(agent.capabilities as string[]).length > 3 && (
                      <span className="text-[10px] text-[var(--text-faint)]">
                        +{(agent.capabilities as string[]).length - 3} more
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
