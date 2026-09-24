import { PageHeader } from "@/components/layout/page-header";
import { SystemSetupWizard } from "@/components/registry/system-setup-wizard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { prisma } from "@/lib/prisma";
import { classifyDiscoveredTool } from "@/lib/ai-classification";
import { getSession } from "@/lib/auth-guard";
import { canRunWorkflows } from "@/lib/workflow";
import { EMPTY_SYSTEM_VALUES } from "@/lib/system-onboarding";
import { loadSystemSetupSuggestions } from "@/lib/system-setup-data";

export const dynamic = "force-dynamic";

export default async function NewSystemPage({
  searchParams,
}: {
  searchParams: Promise<{ discoveredToolId?: string }>;
}) {
  const [{ discoveredToolId }, session] = await Promise.all([searchParams, getSession()]);
  const canEdit = canRunWorkflows(session?.user.role);

  const discoveredTool =
    canEdit && discoveredToolId
      ? await prisma.discoveredAITool.findUnique({ where: { id: discoveredToolId } })
      : null;

  // AI-assisted classification: infer useCase, modelType, data inputs/outputs,
  // risk level, and sensitivity from the tool name + vendor. Best-effort —
  // returns null if the AI provider isn't configured or the call fails.
  const [enrichment, suggestions] = await Promise.all([
    discoveredTool
      ? classifyDiscoveredTool({
          toolName: discoveredTool.toolName,
          vendor: discoveredTool.vendor,
          detectedDomain: discoveredTool.detectedDomain,
          department: discoveredTool.department,
          notes: discoveredTool.notes,
        })
      : null,
    canEdit ? loadSystemSetupSuggestions() : null,
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={discoveredTool ? "Convert Shadow AI Tool" : "Register AI System"}
        description={
          discoveredTool
            ? "Convert a discovered shadow AI tool into a governed system record"
            : "Add a new AI system to the governance registry, one step at a time"
        }
      />
      {enrichment && (
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="info">AI-assisted</Badge>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Fields have been pre-filled by the AI assistant
            </p>
          </div>
          {enrichment.reasoning && (
            <p className="text-xs text-[var(--text-muted)]">{enrichment.reasoning}</p>
          )}
          <p className="text-xs text-[var(--text-faint)]">
            Review and edit anything that looks off as you go through the steps.
          </p>
        </div>
      )}
      {canEdit && suggestions ? (
        <SystemSetupWizard
          initialStepId="basics"
          discoveredToolId={discoveredTool?.id}
          {...suggestions}
          initialValues={
            discoveredTool
              ? {
                  ...EMPTY_SYSTEM_VALUES,
                  name: discoveredTool.toolName,
                  description:
                    enrichment?.description ??
                    `Converted from shadow AI discovery. ${discoveredTool.notes ?? ""}`.trim(),
                  department: discoveredTool.department ?? "Unknown",
                  riskLevel: enrichment?.riskLevel ?? "MEDIUM",
                  status: "UNDER_REVIEW",
                  useCase: enrichment?.useCase ?? "",
                  dataSensitivity: enrichment?.dataSensitivity ?? "INTERNAL",
                  vendor: discoveredTool.vendor ?? "",
                  modelType: enrichment?.modelType ?? "",
                  dataInputs: enrichment?.dataInputs ?? "",
                  dataOutputs: enrichment?.dataOutputs ?? "",
                }
              : EMPTY_SYSTEM_VALUES
          }
        />
      ) : (
        <Card>
          <CardContent className="p-6 text-sm text-[var(--text-muted)]">
            Only admins and compliance officers can register AI systems.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
