import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import {
  ComplianceStatusEditor,
  ComplianceEvidence,
} from "@/components/compliance/compliance-status-editor";

export default async function PolicyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const policy = await prisma.policy.findUnique({
    where: { id },
    include: {
      assignments: {
        include: { aiSystem: { select: { id: true, name: true } } },
      },
    },
  });
  if (!policy) notFound();

  return (
    <div className="space-y-6">
      <PageHeader title={policy.name} description={policy.description ?? undefined} />

      <div className="flex gap-2">
        <Badge variant={statusBadgeVariant(policy.status)}>{policy.status}</Badge>
        <Badge variant="info">{policy.framework.replace(/_/g, " ")}</Badge>
        <Badge variant="outline">v{policy.version}</Badge>
      </div>

      <Card>
        <CardHeader><CardTitle>Policy Content</CardTitle></CardHeader>
        <CardContent>
          <div className="prose prose-sm max-w-none whitespace-pre-wrap text-[var(--text-primary)]">
            {policy.content}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Assigned Systems ({policy.assignments.length})</CardTitle></CardHeader>
        <CardContent>
          {policy.assignments.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No systems assigned to this policy.</p>
          ) : (
            <div className="space-y-3">
              {policy.assignments.map((a) => (
                <div
                  key={a.id}
                  className="rounded-lg border border-[var(--border-subtle)] p-4"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{a.aiSystem.name}</p>
                      {a.assessedAt && (
                        <p className="text-xs text-[var(--text-faint)]">
                          Assessed: {formatDate(a.assessedAt)}
                        </p>
                      )}
                    </div>
                    <ComplianceStatusEditor
                      assignmentId={a.id}
                      policyId={policy.id}
                      aiSystemId={a.aiSystem.id}
                      currentStatus={a.complianceStatus}
                      currentEvidence={a.evidence}
                      systemName={a.aiSystem.name}
                      policyName={policy.name}
                    />
                  </div>
                  <ComplianceEvidence
                    status={a.complianceStatus}
                    evidence={a.evidence}
                  />
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
