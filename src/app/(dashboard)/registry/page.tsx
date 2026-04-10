import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SystemsTable } from "@/components/registry/systems-table";

export default async function RegistryPage() {
  const systems = await prisma.aISystem.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { id: true, name: true } },
      _count: { select: { agents: true, riskAssessments: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="AI System Registry"
        description="Central inventory of all AI systems in your organization"
      >
        <Link href="/registry/new">
          <Button className="bg-[var(--accent)] text-[var(--bg-deep)] hover:brightness-110">
            <Plus className="mr-2 h-4 w-4" />
            Register AI System
          </Button>
        </Link>
      </PageHeader>
      <SystemsTable data={systems} />
    </div>
  );
}
