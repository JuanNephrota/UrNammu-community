import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil, Download, CheckCircle2, XCircle, Clock3 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ReportPreview } from "@/components/reports/report-preview";
import { ExportMenu } from "@/components/reports/export-menu";
import { ScheduleManager } from "@/components/reports/schedule-manager";
import { DeleteReportButton } from "@/components/reports/delete-report-button";
import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { canMutate, canView } from "@/lib/reports/access";
import { DATA_SOURCES, getColumn } from "@/lib/reports/data-sources";
import { formatDateTime } from "@/lib/utils";
import type { ReportConfig, ReportDataSourceKey } from "@/lib/reports/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RUN_STATUS: Record<string, { variant: "success" | "critical" | "warning"; icon: typeof CheckCircle2 }> = {
  SUCCESS: { variant: "success", icon: CheckCircle2 },
  FAILED: { variant: "critical", icon: XCircle },
  PENDING: { variant: "warning", icon: Clock3 },
};

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const definition = await prisma.reportDefinition.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true, email: true } },
      schedules: { orderBy: { createdAt: "desc" } },
      runs: {
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          format: true,
          status: true,
          rowCount: true,
          filename: true,
          error: true,
          deliveredTo: true,
          createdAt: true,
          scheduleId: true,
        },
      },
    },
  });
  if (!definition) notFound();
  if (!canView(definition, session)) redirect("/reports");

  const mutable = canMutate(definition, session);
  const source = DATA_SOURCES[definition.dataSource as ReportDataSourceKey];
  const config = definition.config as unknown as ReportConfig;
  const columnLabels = config.columns
    .map((k) => getColumn(source, k)?.label ?? k)
    .join(", ");

  const schedules = definition.schedules.map((s) => ({
    id: s.id,
    frequency: s.frequency as "DAILY" | "WEEKLY" | "MONTHLY",
    hourUtc: s.hourUtc,
    dayOfWeek: s.dayOfWeek,
    dayOfMonth: s.dayOfMonth,
    format: s.format as "PDF" | "CSV" | "JSON",
    recipients: s.recipients,
    enabled: s.enabled,
    nextRunAt: s.nextRunAt.toISOString(),
    lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/reports"
          className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Reports
        </Link>
        <PageHeader title={definition.name} description={definition.description ?? undefined}>
          <ExportMenu reportId={definition.id} />
          {mutable && (
            <>
              <Button asChild variant="outline">
                <Link href={`/reports/${definition.id}/edit`}>
                  <Pencil className="h-4 w-4" /> Edit
                </Link>
              </Button>
              <DeleteReportButton reportId={definition.id} />
            </>
          )}
        </PageHeader>
      </div>

      {/* Config summary */}
      <Card>
        <CardContent className="grid grid-cols-2 gap-4 p-5 text-sm sm:grid-cols-4">
          <SummaryItem label="Data source" value={source?.label ?? definition.dataSource} />
          <SummaryItem label="Mode" value={config.groupBy ? "Grouped summary" : "Detail rows"} />
          <SummaryItem label="Date range" value={config.dateRange?.preset ?? "All time"} />
          <SummaryItem
            label="Owner"
            value={definition.owner.name ?? definition.owner.email ?? "—"}
          />
          <div className="col-span-2 sm:col-span-4">
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-faint)]">Columns</p>
            <p className="mt-0.5 text-[var(--text-secondary)]">{columnLabels}</p>
          </div>
        </CardContent>
      </Card>

      {/* Live preview */}
      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <ReportPreview
            dataSource={definition.dataSource as ReportDataSourceKey}
            config={config}
          />
        </CardContent>
      </Card>

      {/* Schedules */}
      {mutable && (
        <Card>
          <CardHeader>
            <CardTitle>Schedules</CardTitle>
          </CardHeader>
          <CardContent>
            <ScheduleManager reportId={definition.id} initialSchedules={schedules} />
          </CardContent>
        </Card>
      )}

      {/* Run history */}
      <Card>
        <CardHeader>
          <CardTitle>Run history</CardTitle>
        </CardHeader>
        <CardContent>
          {definition.runs.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No runs yet. Export the report or wait for a scheduled run.
            </p>
          ) : (
            <div className="space-y-1.5">
              {definition.runs.map((run) => {
                const meta = RUN_STATUS[run.status] ?? RUN_STATUS.PENDING;
                const Icon = meta.icon;
                return (
                  <div
                    key={run.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-4 py-2.5 text-sm"
                  >
                    <div className="flex items-center gap-3">
                      <Icon className={`h-4 w-4 ${run.status === "FAILED" ? "text-[var(--critical)]" : run.status === "SUCCESS" ? "text-[var(--success)]" : "text-[var(--warning)]"}`} />
                      <Badge variant="outline">{run.format}</Badge>
                      <span className="text-[var(--text-secondary)]">
                        {run.status === "FAILED"
                          ? run.error ?? "Failed"
                          : `${run.rowCount ?? 0} rows`}
                      </span>
                      {run.scheduleId && <Badge variant="info">Scheduled</Badge>}
                      {run.deliveredTo.length > 0 && (
                        <span className="text-xs text-[var(--text-faint)]">
                          emailed {run.deliveredTo.length}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-[var(--text-faint)]">
                        {formatDateTime(run.createdAt)}
                      </span>
                      {run.status === "SUCCESS" && (
                        <a
                          href={`/api/reports/runs/${run.id}/download`}
                          className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
                        >
                          <Download className="h-3.5 w-3.5" /> Download
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-faint)]">{label}</p>
      <p className="mt-0.5 text-[var(--text-secondary)]">{value}</p>
    </div>
  );
}
