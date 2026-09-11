import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CoverageBar, CoverageLegend } from "@/components/compliance/coverage-bar";
import { loadCatalog, loadFrameworkControls, loadOrgCoverage } from "@/lib/framework-controls-data";
import {
  FRAMEWORK_DESCRIPTIONS,
  FRAMEWORK_LABELS,
  isCatalogFramework,
} from "@/lib/framework-catalog";

export const dynamic = "force-dynamic";

export default async function FrameworkDetailPage({
  params,
}: {
  params: Promise<{ framework: string }>;
}) {
  const { framework } = await params;
  if (!isCatalogFramework(framework)) notFound();

  const catalog = await loadCatalog();
  const [controls, orgCoverage] = await Promise.all([
    loadFrameworkControls(framework),
    loadOrgCoverage(catalog),
  ]);
  const org = orgCoverage[framework];

  const systemIds = org.perSystem.map((p) => p.aiSystemId);
  const systems = systemIds.length
    ? await prisma.aISystem.findMany({
        where: { id: { in: systemIds } },
        select: { id: true, name: true, department: true, riskLevel: true },
      })
    : [];
  const systemById = new Map(systems.map((s) => [s.id, s]));
  const controlsById = new Map(catalog.controls.map((c) => [c.id, c]));

  const byCategory = new Map<string, typeof controls>();
  for (const control of controls) {
    const list = byCategory.get(control.category) ?? [];
    list.push(control);
    byCategory.set(control.category, list);
  }
  const perControl = new Map(org.perControl.map((p) => [p.control.id, p]));

  return (
    <div className="space-y-6">
      <PageHeader title={FRAMEWORK_LABELS[framework]} description={FRAMEWORK_DESCRIPTIONS[framework]}>
        <Link
          href="/compliance/frameworks"
          className="inline-flex items-center gap-1 text-sm text-[var(--accent)] hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All frameworks
        </Link>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Average coverage</p>
            <p className="mt-1 text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              {org.systemsInScope === 0 ? "—" : `${org.avgCoveragePct}%`}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              across {org.systemsInScope} system{org.systemsInScope === 1 ? "" : "s"} in scope
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Controls</p>
            <p className="mt-1 text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              {org.controlCount}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {org.controlsSatisfiedSomewhere} satisfied on at least one system
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">Crosswalk links</p>
            <p className="mt-1 text-3xl font-bold" style={{ fontFamily: "var(--font-display)" }}>
              {controls.reduce((sum, c) => sum + (catalog.crosswalk.get(c.id)?.size ?? 0), 0)}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">to controls in other frameworks</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Systems in scope</CardTitle>
        </CardHeader>
        <CardContent>
          {org.perSystem.length === 0 ? (
            <p className="text-sm text-[var(--text-muted)]">
              No system has a direct assessment against this framework yet. Open a system in the registry,
              switch to its Compliance tab, and pick {FRAMEWORK_LABELS[framework]} in the Framework Controls card.
            </p>
          ) : (
            <div className="space-y-3">
              <CoverageLegend />
              {org.perSystem
                .slice()
                .sort((a, b) => b.summary.coveragePct - a.summary.coveragePct)
                .map(({ aiSystemId, summary }) => {
                  const system = systemById.get(aiSystemId);
                  return (
                    <Link
                      key={aiSystemId}
                      href={`/registry/${aiSystemId}?tab=compliance&framework=${framework}`}
                      className="block rounded-md border border-[var(--border-subtle)] p-3 hover:bg-[var(--bg-hover)]"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{system?.name ?? aiSystemId}</p>
                          <p className="text-xs text-[var(--text-muted)]">
                            {system?.department ?? "—"} · {summary.compliant} compliant · {summary.inherited} inherited ·{" "}
                            {summary.partiallyCompliant} partial · {summary.nonCompliant} non-compliant
                          </p>
                        </div>
                        <span className="font-mono text-sm text-[var(--text-secondary)]">
                          {summary.coveragePct}%
                        </span>
                      </div>
                      <CoverageBar
                        className="mt-2"
                        total={summary.total}
                        compliant={summary.compliant}
                        inherited={summary.inherited}
                        partiallyCompliant={summary.partiallyCompliant}
                        nonCompliant={summary.nonCompliant}
                      />
                    </Link>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Control catalog</CardTitle>
          <p className="text-xs text-[var(--text-muted)]">
            Seeded by migration and mirrored in the codebase. Crosswalk links show which controls in other
            frameworks share the underlying obligation; compliance on either side is inherited by the other.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {Array.from(byCategory.entries()).map(([category, rows]) => (
            <div key={category} className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                {category}
              </p>
              <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)]">
                {rows.map((control) => {
                  const stats = perControl.get(control.id);
                  const linked = Array.from(catalog.crosswalk.get(control.id) ?? [])
                    .map((id) => controlsById.get(id))
                    .filter((c): c is NonNullable<typeof c> => Boolean(c))
                    .sort((a, b) => a.framework.localeCompare(b.framework) || a.sortOrder - b.sortOrder);
                  return (
                    <div key={control.id} id={anchorId(control.code)} className="p-4 scroll-mt-24">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="font-mono normal-case tracking-normal">
                              {control.code}
                            </Badge>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{control.title}</p>
                          </div>
                          <p className="mt-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                            {control.description}
                          </p>
                          {linked.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {linked.map((c) => (
                                <Link
                                  key={c.id}
                                  href={`/compliance/frameworks/${c.framework}#${anchorId(c.code)}`}
                                  className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-2 py-0.5 text-[11px] text-[var(--text-muted)] hover:border-[var(--accent)]/50 hover:text-[var(--accent)]"
                                  title={c.title}
                                >
                                  {FRAMEWORK_LABELS[c.framework]} {c.code}
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                        {org.systemsInScope > 0 && stats && (
                          <div className="shrink-0 text-right">
                            <p className="text-sm font-semibold text-[var(--text-primary)]">
                              {stats.satisfiedSystems}
                              <span className="text-xs font-normal text-[var(--text-faint)]">
                                /{org.systemsInScope}
                              </span>
                            </p>
                            <p className="text-[10px] uppercase tracking-wider text-[var(--text-faint)]">
                              systems satisfied
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function anchorId(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
