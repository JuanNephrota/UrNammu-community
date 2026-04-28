import Link from "next/link";
import { Plus } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SystemsTable } from "@/components/registry/systems-table";
import { getSystemGovernanceRecommendations } from "@/lib/governance-recommendations";

export default async function RegistryPage() {
  const systems = await prisma.aISystem.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      owner: { select: { id: true, name: true } },
      approvals: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { decision: true },
      },
      policyAssignments: {
        select: {
          id: true,
          complianceStatus: true,
          policy: { select: { id: true, name: true, rules: true } },
        },
      },
      governanceReviews: {
        orderBy: { createdAt: "desc" },
        select: { stage: true, approved: true },
      },
      governanceExceptions: {
        select: { status: true, expiresAt: true },
      },
      governanceIncidents: {
        select: { id: true, title: true, status: true },
      },
      _count: { select: { agents: true, riskAssessments: true } },
    },
  });

  const systemsWithRecommendations = systems.map((system) => {
    const recommendationSummary = getSystemGovernanceRecommendations({
      id: system.id,
      status: system.status,
      riskLevel: system.riskLevel,
      vendor: system.vendor,
      department: system.department,
      modelType: system.modelType,
      dataSensitivity: system.dataSensitivity,
      reviewIntervalDays: system.reviewIntervalDays,
      nextReviewDate: system.nextReviewDate,
      requireOwnerApproval: system.requireOwnerApproval,
      requireSecurityApproval: system.requireSecurityApproval,
      requireLegalApproval: system.requireLegalApproval,
      requireComplianceApproval: system.requireComplianceApproval,
      riskAssessmentsCount: system._count.riskAssessments,
      latestApprovalDecision: system.approvals[0]?.decision ?? null,
      policyAssignments: system.policyAssignments,
      governanceReviews: system.governanceReviews,
      governanceExceptions: system.governanceExceptions,
      governanceIncidents: system.governanceIncidents,
    });

    return {
      ...system,
      topRecommendation: recommendationSummary.primary?.title ?? "Continue monitoring telemetry and alerts",
      topRecommendationTone: recommendationSummary.primary?.tone ?? "success",
    };
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

      <SystemsTable data={systemsWithRecommendations} />
    </div>
  );
}
