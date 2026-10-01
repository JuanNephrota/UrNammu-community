import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { AgentForm } from "@/components/forms/agent-form";

export default async function NewAgentPage() {
  const [systems, users] = await Promise.all([
    prisma.aISystem.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.user.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Register AI Agent"
        description="Add a new autonomous agent to the registry"
      />
      <AgentForm systems={systems} users={users} />
    </div>
  );
}
