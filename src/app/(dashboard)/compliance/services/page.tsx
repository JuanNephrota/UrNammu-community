import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Badge, riskBadgeVariant, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STATUS_OPTIONS = [
  "COMPLIANT",
  "PARTIALLY_COMPLIANT",
  "NON_COMPLIANT",
  "NOT_ASSESSED",
] as const;

type ComplianceStatusFilter = (typeof STATUS_OPTIONS)[number];

const STATUS_LABELS: Record<ComplianceStatusFilter, string> = {
  COMPLIANT: "Compliant",
  PARTIALLY_COMPLIANT: "Partial",
  NON_COMPLIANT: "Non-Compliant",
  NOT_ASSESSED: "Not Assessed",
};

function isComplianceStatus(value: string | undefined): value is ComplianceStatusFilter {
  return STATUS_OPTIONS.includes(value as ComplianceStatusFilter);
}

export default async function ComplianceServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const activeStatus: ComplianceStatusFilter = isComplianceStatus(status)
    ? status
    : "COMPLIANT";

  const systems = await prisma.aISystem.findMany({
    where: {
      policyAssignments: {
        some: {
          complianceStatus: activeStatus,
        },
      },
    },
    orderBy: { name: "asc" },
    include: {
      owner: { select: { id: true, name: true } },
      policyAssignments: {
        where: { complianceStatus: activeStatus },
        include: {
          policy: { select: { id: true, name: true, framework: true } },
          issues: {
            orderBy: [{ status: "asc" }, { severity: "desc" }, { createdAt: "asc" }],
            take: 5,
          },
        },
      },
      _count: { select: { agents: true, riskAssessments: true } },
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${STATUS_LABELS[activeStatus]} Services`}
        description="Services filtered by current compliance status across assigned policies"
      >
        <Link href="/compliance">
          <Button variant="outline">Back to Compliance</Button>
        </Link>
      </PageHeader>

      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((option) => (
          <Link key={option} href={`/compliance/services?status=${option}`}>
            <Badge variant={option === activeStatus ? statusBadgeVariant(option) : "outline"}>
              {STATUS_LABELS[option]}
            </Badge>
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {systems.length} service{systems.length === 1 ? "" : "s"} in {STATUS_LABELS[activeStatus]}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {systems.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No services match this compliance filter yet.
            </p>
          ) : (
            <div className="space-y-4">
              {systems.map((system) => (
                <Link
                  key={system.id}
                  href={`/registry/${system.id}?tab=compliance`}
                  className="block rounded-lg border border-[var(--border-subtle)] p-4 hover:bg-[var(--bg-hover)]"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                          {system.name}
                        </p>
                        <Badge variant={riskBadgeVariant(system.riskLevel)}>
                          {system.riskLevel}
                        </Badge>
                        <Badge variant={statusBadgeVariant(system.status)}>
                          {system.status.replace(/_/g, " ")}
                        </Badge>
                        <Badge variant="outline">{system.department}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-[var(--text-muted)]">
                        Owner: {system.owner.name ?? "—"} · {system._count.agents} agents · {system._count.riskAssessments} risk assessments
                      </p>
                    </div>
                    <Badge variant={statusBadgeVariant(activeStatus)}>
                      {STATUS_LABELS[activeStatus]}
                    </Badge>
                  </div>

                  <div className="mt-4 space-y-3">
                    {system.policyAssignments.map((assignment) => (
                      <div
                        key={assignment.id}
                        className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-medium text-[var(--text-primary)]">
                              {assignment.policy.name}
                            </p>
                            <p className="text-[11px] text-[var(--text-faint)]">
                              {assignment.policy.framework.replace(/_/g, " ")}
                            </p>
                          </div>
                          <p className="text-[11px] text-[var(--text-muted)]">
                            {assignment.issues.length} open-format issue{assignment.issues.length === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
