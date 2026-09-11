import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CoverageLegend } from "@/components/compliance/coverage-bar";
import { loadOrgCoverage } from "@/lib/framework-controls-data";
import {
  CATALOG_FRAMEWORKS,
  FRAMEWORK_DESCRIPTIONS,
  FRAMEWORK_LABELS,
} from "@/lib/framework-catalog";

export const dynamic = "force-dynamic";

export default async function FrameworksPage() {
  const coverage = await loadOrgCoverage();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Framework Coverage"
        description="Seeded control catalog for each framework, with per-system assessments rolled up across the registry. A control marked compliant in one framework satisfies its crosswalked peers."
      >
        <Link
          href="/compliance"
          className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
        >
          Back to Compliance <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </PageHeader>

      <CoverageLegend />

      <div className="grid gap-6 lg:grid-cols-2">
        {CATALOG_FRAMEWORKS.map((framework) => {
          const org = coverage[framework];
          const tone =
            org.systemsInScope === 0
              ? "var(--text-muted)"
              : org.avgCoveragePct >= 75
                ? "var(--success)"
                : org.avgCoveragePct >= 40
                  ? "var(--warning)"
                  : "var(--critical)";
          return (
            <Link key={framework} href={`/compliance/frameworks/${framework}`} className="block group">
              <Card className="h-full transition-all group-hover:border-[var(--accent)]/50">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <BookOpen className="h-4 w-4 text-[var(--accent)]" />
                        {FRAMEWORK_LABELS[framework]}
                      </CardTitle>
                      <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-muted)]">
                        {FRAMEWORK_DESCRIPTIONS[framework]}
                      </p>
                    </div>
                    <div className="text-right">
                      <div
                        className="text-3xl font-bold leading-none"
                        style={{ fontFamily: "var(--font-display)", color: tone }}
                      >
                        {org.systemsInScope === 0 ? "—" : `${org.avgCoveragePct}%`}
                      </div>
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                        avg coverage
                      </p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <dl className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2">
                      <dt className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Controls</dt>
                      <dd className="text-lg font-semibold text-[var(--text-primary)]">{org.controlCount}</dd>
                    </div>
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2">
                      <dt className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Systems in scope</dt>
                      <dd className="text-lg font-semibold text-[var(--text-primary)]">{org.systemsInScope}</dd>
                    </div>
                    <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-2">
                      <dt className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Satisfied somewhere</dt>
                      <dd className="text-lg font-semibold text-[var(--text-primary)]">
                        {org.controlsSatisfiedSomewhere}
                        <span className="text-xs font-normal text-[var(--text-faint)]">/{org.controlCount}</span>
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-3 text-xs text-[var(--text-faint)]">
                    {org.systemsInScope === 0
                      ? "No system has been assessed against this framework yet. Open a system's Compliance tab to start."
                      : "Open to browse controls, crosswalk links, and per-system coverage."}
                  </p>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
