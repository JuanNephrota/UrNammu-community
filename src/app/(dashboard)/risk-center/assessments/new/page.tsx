import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { RiskAssessmentForm } from "@/components/forms/risk-assessment-form";

export default async function NewAssessmentPage() {
  const systems = await prisma.aISystem.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      department: true,
      useCase: true,
      vendor: true,
      modelType: true,
      dataInputs: true,
      dataOutputs: true,
      dataSensitivity: true,
      reviewIntervalDays: true,
      requireOwnerApproval: true,
      requireSecurityApproval: true,
      requireLegalApproval: true,
      requireComplianceApproval: true,
      policyAssignments: {
        select: {
          complianceStatus: true,
        },
      },
      governanceReviews: {
        orderBy: { createdAt: "desc" },
        select: {
          stage: true,
          approved: true,
        },
      },
      approvals: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          decision: true,
        },
      },
      governanceIncidents: {
        where: { status: { in: ["OPEN", "ACKNOWLEDGED"] } },
        select: { id: true },
      },
      agents: {
        select: {
          id: true,
          name: true,
          autonomyLevel: true,
          humanReviewRequired: true,
          humanReviewTriggers: true,
          connectedSystems: true,
          riskLevel: true,
          status: true,
          aiSystemId: true,
        },
      },
      _count: {
        select: {
          evidenceArtifacts: true,
          riskAssessments: true,
        },
      },
    },
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
