import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ReportBuilder } from "@/components/reports/report-builder";
import { getSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import { serializeRegistry } from "@/lib/reports/data-sources";
import { canMutate } from "@/lib/reports/access";
import type { ReportConfig, ReportDataSourceKey } from "@/lib/reports/types";

export const dynamic = "force-dynamic";

export default async function EditReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();
  if (!session) redirect("/login");

  const definition = await prisma.reportDefinition.findUnique({ where: { id } });
  if (!definition) notFound();
  if (!canMutate(definition, session)) redirect(`/reports/${id}`);

  const registry = serializeRegistry();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/reports/${id}`}
          className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to report
        </Link>
        <PageHeader title="Edit Report" description="Adjust the data, columns, filters, and shape." />
      </div>
      <ReportBuilder
        registry={registry}
        initial={{
          id: definition.id,
          name: definition.name,
          description: definition.description,
          dataSource: definition.dataSource as ReportDataSourceKey,
          visibility: definition.visibility as "PRIVATE" | "SHARED",
          config: definition.config as unknown as ReportConfig,
        }}
      />
    </div>
  );
}
