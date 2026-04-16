import { PageHeader } from "@/components/layout/page-header";
import { AISystemForm } from "@/components/forms/ai-system-form";
import { Badge } from "@/components/ui/badge";
import { prisma } from "@/lib/prisma";
import { classifyDiscoveredTool } from "@/lib/ai-classification";

export default async function NewSystemPage({
  searchParams,
}: {
  searchParams: Promise<{ discoveredToolId?: string }>;
}) {
  const { discoveredToolId } = await searchParams;
  const discoveredTool = discoveredToolId
    ? await prisma.discoveredAITool.findUnique({ where: { id: discoveredToolId } })
    : null;

  // AI-assisted classification: infer useCase, modelType, data inputs/outputs,
  // risk level, and sensitivity from the tool name + vendor. Best-effort —
  // returns null if the AI provider isn't configured or the call fails.
  const enrichment = discoveredTool
    ? await classifyDiscoveredTool({
        toolName: discoveredTool.toolName,
        vendor: discoveredTool.vendor,
        detectedDomain: discoveredTool.detectedDomain,
        department: discoveredTool.department,
        notes: discoveredTool.notes,
      })
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
      {enrichment && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="info">AI-assisted</Badge>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Fields below have been pre-filled by the AI assistant
            </p>
          </div>
          {enrichment.reasoning && (
            <p className="text-xs text-[var(--text-muted)]">
              {enrichment.reasoning}
            </p>
          )}
          <p className="text-xs text-[var(--text-faint)]">
            Review and edit anything that looks off before saving.
          </p>
        </div>
      )}
      <AISystemForm
        initialData={
          discoveredTool
            ? {
                discoveredToolId: discoveredTool.id,
                name: discoveredTool.toolName,
                description:
                  enrichment?.description ??
                  `Converted from shadow AI discovery. ${discoveredTool.notes ?? ""}`.trim(),
                version: null,
                department: discoveredTool.department ?? "Unknown",
                riskLevel: enrichment?.riskLevel ?? "MEDIUM",
                status: "UNDER_REVIEW",
                useCase: enrichment?.useCase ?? null,
                dataSensitivity: enrichment?.dataSensitivity ?? "INTERNAL",
                vendor: discoveredTool.vendor,
                modelType: enrichment?.modelType ?? null,
                dataInputs: enrichment?.dataInputs ?? null,
                dataOutputs: enrichment?.dataOutputs ?? null,
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
