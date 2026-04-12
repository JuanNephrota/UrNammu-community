import { PageHeader } from "@/components/layout/page-header";
import { AISystemForm } from "@/components/forms/ai-system-form";
import { prisma } from "@/lib/prisma";

export default async function NewSystemPage({
  searchParams,
}: {
  searchParams: Promise<{ discoveredToolId?: string }>;
}) {
  const { discoveredToolId } = await searchParams;
  const discoveredTool = discoveredToolId
    ? await prisma.discoveredAITool.findUnique({ where: { id: discoveredToolId } })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={discoveredTool ? "Convert Shadow AI Tool" : "Register AI System"}
        description={
          discoveredTool
            ? "Convert a discovered shadow AI tool into a governed system record"
            : "Add a new AI system to the governance registry"
        }
      />
      <AISystemForm
        initialData={
          discoveredTool
            ? {
                discoveredToolId: discoveredTool.id,
                name: discoveredTool.toolName,
                description: `Converted from shadow AI discovery. ${discoveredTool.notes ?? ""}`.trim(),
                version: null,
                department: discoveredTool.department ?? "Unknown",
                riskLevel: "MEDIUM",
                status: "UNDER_REVIEW",
                useCase: null,
                dataSensitivity: "INTERNAL",
                vendor: discoveredTool.vendor,
                modelType: null,
                dataInputs: null,
                dataOutputs: null,
                reviewIntervalDays: 365,
                nextReviewDate: null,
                requireOwnerApproval: true,
                requireSecurityApproval: true,
                requireLegalApproval: false,
                requireComplianceApproval: true,
              }
            : undefined
        }
      />
    </div>
  );
}
