import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { AgentForm } from "@/components/forms/agent-form";

export default async function EditAgentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = await prisma.aIAgent.findUnique({ where: { id } });
  if (!agent) notFound();

  const systems = await prisma.aISystem.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit: ${agent.name}`}
        description="Update agent configuration"
      />
      <AgentForm
        initialData={{
          id: agent.id,
          name: agent.name,
          description: agent.description,
          aiSystemId: agent.aiSystemId,
          capabilities: agent.capabilities as string[],
          accessLevel: agent.accessLevel,
          autonomyLevel: agent.autonomyLevel,
          connectedSystems: agent.connectedSystems as string[],
          humanReviewRequired: agent.humanReviewRequired,
          riskLevel: agent.riskLevel,
          status: agent.status,
          department: agent.department,
        }}
        systems={systems}
      />
    </div>
  );
}
