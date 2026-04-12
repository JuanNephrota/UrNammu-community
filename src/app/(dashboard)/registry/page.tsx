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

      <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-5 py-4 text-sm text-[var(--text-muted)] leading-relaxed">
        An <span className="font-semibold text-[var(--text-primary)]">AI System</span> is any software that uses machine learning models, large language models, or algorithmic decision-making to generate outputs, predictions, or recommendations. This includes third-party AI services (e.g. ChatGPT, Claude), internally developed models, AI-powered SaaS tools, and automated decision systems that impact business operations, customers, or employees.
      </div>

      <SystemsTable data={systems} />
    </div>
  );
}
