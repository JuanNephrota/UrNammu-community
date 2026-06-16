import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { ReportBuilder } from "@/components/reports/report-builder";
import { getSession } from "@/lib/auth-guard";
import { serializeRegistry } from "@/lib/reports/data-sources";

export const dynamic = "force-dynamic";

const AUTHOR_ROLES = ["ADMIN", "COMPLIANCE_OFFICER"];

export default async function NewReportPage() {
  const session = await getSession();
  if (!session || !AUTHOR_ROLES.includes(session.user.role)) {
    redirect("/reports");
  }
  const registry = serializeRegistry();

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/reports"
          className="mb-2 inline-flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Reports
        </Link>
        <PageHeader title="New Report" description="Pick a data source, choose columns, filter, and shape the output." />
      </div>
      <ReportBuilder registry={registry} />
    </div>
  );
}
