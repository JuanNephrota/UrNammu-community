import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { HelpHint } from "@/components/help/help-hint";
import { CoverageBar, CoverageLegend } from "@/components/compliance/coverage-bar";
import { ControlMappingEditor } from "@/components/compliance/control-mapping-editor";
import { FrameworkGapAnalysisButton } from "@/components/compliance/framework-gap-analysis-button";
import { CATALOG_FRAMEWORKS, FRAMEWORK_LABELS, type CatalogFramework } from "@/lib/framework-catalog";
import type { SystemFrameworkCoverage } from "@/lib/framework-coverage";
import { formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

/**
 * Server component. Shows a system's assessment against every control of the
 * selected framework, with a framework switcher (links preserve the tab) and
 * per-control inline editors.
 */
export function FrameworkControlsCard({
  systemId,
  systemName,
  selected,
  coverage,
  basePath,
}: {
  systemId: string;
  systemName: string;
  selected: CatalogFramework;
  coverage: Record<CatalogFramework, SystemFrameworkCoverage>;
  /** e.g. `/registry/${id}?tab=compliance` — `&framework=` is appended. */
  basePath: string;
}) {
  const current = coverage[selected];
  const summary = current.summary;

  const byCategory = new Map<string, typeof current.rows>();
  for (const row of current.rows) {
    const list = byCategory.get(row.control.category) ?? [];
    list.push(row);
    byCategory.set(row.control.category, list);
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-1.5 text-sm">
              Framework Controls
              <HelpHint hint="framework_controls" />
            </CardTitle>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Per-control assessment against the seeded catalog. A control marked Compliant here also
              satisfies its crosswalked peers in the other frameworks.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <FrameworkGapAnalysisButton
              systemName={systemName}
              frameworkLabel={FRAMEWORK_LABELS[selected]}
              mappings={current.rows.map((r) => ({
                requirement: `${r.control.code} — ${r.control.title}`,
                status: r.status,
              }))}
            />
            <Link
              href={`/compliance/frameworks/${selected}`}
              className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              Catalog <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {CATALOG_FRAMEWORKS.map((framework) => {
            const s = coverage[framework].summary;
            const active = framework === selected;
            return (
              <Link
                key={framework}
                href={`${basePath}&framework=${framework}`}
                className={cn(
                  "flex min-w-[150px] flex-1 flex-col gap-1 rounded-lg border px-3 py-2 transition-all hover:bg-[var(--bg-hover)]",
                  active
                    ? "border-[var(--accent)] bg-[var(--accent-dim)]"
                    : "border-[var(--border-subtle)] bg-[var(--bg-base)]"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      active ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"
                    )}
                  >
                    {FRAMEWORK_LABELS[framework]}
                  </span>
                  <span className="text-xs font-mono text-[var(--text-muted)]">{s.coveragePct}%</span>
                </div>
                <CoverageBar
                  total={s.total}
                  compliant={s.compliant}
                  inherited={s.inherited}
                  partiallyCompliant={s.partiallyCompliant}
                  nonCompliant={s.nonCompliant}
                  height="h-1.5"
                />
              </Link>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="space-y-5 pt-0">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-4 py-3">
          <div className="text-sm">
            <span className="font-semibold text-[var(--text-primary)]">
              {summary.compliant + summary.inherited} of {summary.total}
            </span>{" "}
            <span className="text-[var(--text-muted)]">
              {FRAMEWORK_LABELS[selected]} controls covered · {summary.assessedPct}% directly assessed
            </span>
          </div>
          <CoverageLegend />
        </div>

        {Array.from(byCategory.entries()).map(([category, rows]) => (
          <div key={category} className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              {category}
            </p>
            <div className="divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-subtle)]">
              {rows.map((row) => (
                <div key={row.control.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="font-mono normal-case tracking-normal">
                        {row.control.code}
                      </Badge>
                      <p className="text-sm font-medium text-[var(--text-primary)]">{row.control.title}</p>
                    </div>
                    {row.status === "INHERITED" && row.inheritedFrom.length > 0 && (
                      <p className="mt-1 text-[11px] text-[var(--info)]">
                        Satisfied via{" "}
                        {row.inheritedFrom
                          .map((c) => `${FRAMEWORK_LABELS[c.framework]} ${c.code}`)
                          .join(", ")}
                      </p>
                    )}
                    {row.evidence && row.source === "direct" && (
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                        {row.evidence}
                      </p>
                    )}
                    {row.crosswalk.length > 0 && (
                      <p className="mt-1.5 text-[11px] text-[var(--text-faint)]">
                        Crosswalk:{" "}
                        {row.crosswalk
                          .map((c) => `${FRAMEWORK_LABELS[c.framework]} ${c.code}`)
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <ControlMappingEditor
                      systemId={systemId}
                      systemName={systemName}
                      controlId={row.control.id}
                      controlCode={row.control.code}
                      controlTitle={row.control.title}
                      frameworkLabel={FRAMEWORK_LABELS[selected]}
                      currentStatus={row.status}
                      currentEvidence={row.evidence}
                      inheritedFrom={row.inheritedFrom.map(
                        (c) => `${FRAMEWORK_LABELS[c.framework]} ${c.code}`
                      )}
                    />
                    {row.assessedAt && row.source === "direct" && (
                      <span className="text-[10px] text-[var(--text-faint)]">
                        {formatDate(row.assessedAt)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
