import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { RiskAssessmentForm } from "@/components/forms/risk-assessment-form";

export default async function NewAssessmentPage() {
  const systems = await prisma.aISystem.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Risk Assessment"
        description="Evaluate risk dimensions for an AI system"
      />
      <RiskAssessmentForm systems={systems} />
    </div>
  );
}
