import Link from "next/link";
import { Plus, Bot } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AutonomyBadge } from "@/components/ui/autonomy-tooltip";
import { getSession } from "@/lib/auth-guard";
import { formatDateTime } from "@/lib/utils";
import { AGENT_DISCOVERY_SOURCE_LABELS, isAgentDiscoverySource, type AgentSignal } from "@/lib/agent-discovery";
import { CLIENT_LABELS } from "@/lib/caller-fingerprint";
import { DiscoveredAgentsTable, type DiscoveredAgentRow } from "@/components/agents/discovered-agents-table";

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const showDiscovered = view === "discovered";
  const [session, openDiscoveries] = await Promise.all([
    getSession(),
    prisma.discoveredAgent.count({ where: { status: { in: ["DISCOVERED", "UNDER_REVIEW"] } } }),
  ]);
  const canEdit = session?.user.role === "ADMIN" || session?.user.role === "COMPLIANCE_OFFICER";

  const tabClass = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-sm transition-colors ${
      active
        ? "bg-[var(--accent-dim)] text-[var(--accent)]"
        : "text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
    }`;

  const header = (
    <>
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
      <nav className="flex gap-1" aria-label="Agent views">
        <Link href="/agents" className={tabClass(!showDiscovered)}>
          Registry
        </Link>
        <Link href="/agents?view=discovered" className={tabClass(showDiscovered)}>
          Discovered
          {openDiscoveries > 0 && (
            <span className="ml-1.5 rounded bg-[var(--warning-dim)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--warning-strong)]">
              {openDiscoveries}
            </span>
          )}
        </Link>
      </nav>
    </>
  );

  if (showDiscovered) {
    const discovered = await prisma.discoveredAgent.findMany({
      orderBy: [{ lastSeenAt: "desc" }, { createdAt: "desc" }],
      take: 500,
      include: { linkedAgent: { select: { id: true, name: true } } },
    });
    const rows: DiscoveredAgentRow[] = discovered.map((d) => ({
      id: d.id,
      source: d.source,
      sourceLabel: isAgentDiscoverySource(d.source) ? AGENT_DISCOVERY_SOURCE_LABELS[d.source] : d.source,
      name: d.name,
      description: d.description,
      platform: d.platform,
      framework: d.framework ? CLIENT_LABELS[d.framework] ?? d.framework : null,
      status: d.status,
      confidence: d.confidence,
      score: d.score,
      signals: Array.isArray(d.signals) ? (d.signals as unknown as AgentSignal[]) : [],
      tools: d.tools,
      mcpServers: d.mcpServers,
      models: d.models,
      userEmails: d.userEmails,
      requestCount: d.requestCount,
      // Formatted on the server so the client render matches (no hydration drift).
      lastSeenAt: d.lastSeenAt ? formatDateTime(d.lastSeenAt) : null,
      linkedAgent: d.linkedAgent,
    }));
    return (
      <div className="space-y-6">
        {header}
        <DiscoveredAgentsTable rows={rows} canEdit={canEdit} />
      </div>
    );
  }

  const agents = await prisma.aIAgent.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { name: true } },
      aiSystem: { select: { id: true, name: true } },
    },
  });

  return (
    <div className="space-y-6">
      {header}

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
                    <AutonomyBadge level={agent.autonomyLevel} />
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
