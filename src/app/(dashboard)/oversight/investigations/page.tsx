import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { InvestigationEditor } from "@/components/oversight/investigation-editor";

export default async function OversightInvestigationsPage() {
  const investigations = await prisma.investigation.findMany({
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    include: {
      ownerUser: { select: { name: true, email: true } },
      aiSystem: { select: { id: true, name: true } },
      alert: { select: { id: true, title: true, severity: true } },
      governanceIncident: { select: { id: true, title: true, severity: true } },
    },
    take: 100,
  });

  const openCount = investigations.filter((item) => item.status !== "RESOLVED").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Investigations"
        description="Track alert and incident follow-up with owner, notes, and resolution progress"
      />

      <Card>
        <CardHeader>
          <CardTitle>Open Investigations ({openCount})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {investigations.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">No investigations yet.</p>
          ) : (
            investigations.map((investigation) => (
              <div
                key={investigation.id}
                className="rounded-xl border border-[var(--border-subtle)] p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-[var(--text-primary)]">
                        {investigation.title}
                      </p>
                      <Badge variant={statusBadgeVariant(investigation.status)}>
                        {investigation.status.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-[var(--text-muted)]">
                      Owner: {investigation.ownerUser?.name ?? investigation.ownerUser?.email ?? "Unassigned"} · Updated {formatDateTime(investigation.updatedAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {investigation.aiSystem && (
                        <Link href={`/registry/${investigation.aiSystem.id}`}>
                          <Badge variant="outline">{investigation.aiSystem.name}</Badge>
                        </Link>
                      )}
                      {investigation.alert && (
                        <Badge variant={riskBadgeVariant(investigation.alert.severity)}>
                          Alert: {investigation.alert.title}
                        </Badge>
                      )}
                      {investigation.governanceIncident && (
                        <Badge variant={riskBadgeVariant(investigation.governanceIncident.severity)}>
                          Incident: {investigation.governanceIncident.title}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <InvestigationEditor investigation={investigation} />
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
