import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { AgentForm } from "@/components/forms/agent-form";

export default async function NewAgentPage() {
  const systems = await prisma.aISystem.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Register AI Agent"
        description="Add a new autonomous agent to the registry"
      />
      <AgentForm systems={systems} />
    </div>
  );
}
