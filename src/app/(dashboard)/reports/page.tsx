import Link from "next/link";
import { BarChart3, Plus, Calendar, FileClock, Globe, Lock } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TemplateGallery } from "@/components/reports/template-gallery";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth-guard";
import { REPORT_TEMPLATES } from "@/lib/reports/templates";
import { DATA_SOURCES } from "@/lib/reports/data-sources";
import { formatDate } from "@/lib/utils";
import type { ReportDataSourceKey } from "@/lib/reports/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const AUTHOR_ROLES = ["ADMIN", "COMPLIANCE_OFFICER"];

export default async function ReportsPage() {
  const session = await getSession();
  const isAuthor = session ? AUTHOR_ROLES.includes(session.user.role) : false;

  const reports = await prisma.reportDefinition.findMany({
    where: {
      OR: [
        ...(session ? [{ ownerId: session.user.userId }] : []),
        { visibility: "SHARED" as const },
      ],
    },
    orderBy: { updatedAt: "desc" },
    include: {
      owner: { select: { name: true, email: true } },
      _count: { select: { schedules: true, runs: true } },
    },
  });

  return (
    <div className="space-y-8">
      <PageHeader
        title="Reports"
        description="Build, export, and schedule custom reports across your governance data."
      >
        {isAuthor && (
          <Button asChild>
            <Link href="/reports/new">
              <Plus className="h-4 w-4" /> New Report
            </Link>
          </Button>
        )}
      </PageHeader>

      {/* Templates */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[var(--text-faint)]">
          Start from a template
        </h2>
        <TemplateGallery templates={REPORT_TEMPLATES} canCreate={isAuthor} />
        {!isAuthor && (
          <p className="text-xs text-[var(--text-faint)]">
            Creating and scheduling reports requires an Admin or Compliance Officer role. You can view and export reports shared with you.
          </p>
        )}
      </section>

      {/* Saved reports */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-[0.15em] text-[var(--text-faint)]">
          Saved reports
        </h2>
        {reports.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
              <BarChart3 className="h-8 w-8 text-[var(--text-faint)]" />
              <p className="text-sm text-[var(--text-muted)]">No saved reports yet.</p>
              {isAuthor && (
                <p className="text-xs text-[var(--text-faint)]">
                  Use a template above or create a new report to get started.
                </p>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {reports.map((report) => (
              <Link key={report.id} href={`/reports/${report.id}`}>
                <Card className="group h-full transition-all hover:border-[var(--accent-border)] hover:shadow-[0_0_0_1px_var(--accent-border)]">
                  <CardContent className="flex h-full flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                        {report.name}
                      </h3>
                      <Badge variant={report.visibility === "SHARED" ? "info" : "outline"}>
                        {report.visibility === "SHARED" ? (
                          <Globe className="mr-1 h-3 w-3" />
                        ) : (
                          <Lock className="mr-1 h-3 w-3" />
                        )}
                        {report.visibility === "SHARED" ? "Shared" : "Private"}
                      </Badge>
                    </div>
                    {report.description && (
                      <p className="line-clamp-2 text-xs text-[var(--text-muted)]">
                        {report.description}
                      </p>
                    )}
                    <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-faint)]">
                      <span>{DATA_SOURCES[report.dataSource as ReportDataSourceKey]?.label}</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" /> {report._count.schedules}
                      </span>
                      <span className="flex items-center gap-1">
                        <FileClock className="h-3 w-3" /> {report._count.runs}
                      </span>
                      <span>· {formatDate(report.updatedAt)}</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
