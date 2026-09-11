/**
 * Framework coverage computation — pure functions over catalog controls,
 * crosswalk pairs and ComplianceMapping rows. No Prisma here so the logic is
 * unit-testable; callers load the rows and pass them in.
 *
 * Definitions:
 * - A control is DIRECTLY assessed when the system has a ComplianceMapping
 *   pointing at it with any status other than NOT_ASSESSED.
 * - A control is INHERITED when it has no direct assessment but at least one
 *   crosswalked control (in another framework) is directly COMPLIANT on the
 *   same system. Inheritance is one hop only and never chains.
 * - Coverage % = (direct COMPLIANT + INHERITED) / controls in framework.
 *   Partially compliant controls do not count toward coverage; they are
 *   surfaced separately so the gap is visible rather than half-credited.
 */

import type { ComplianceFramework, ComplianceStatus } from "@prisma/client";

export type CoverageControl = {
  id: string;
  framework: ComplianceFramework;
  code: string;
  title: string;
  category: string;
  sortOrder: number;
};

export type CoverageCrosswalkPair = {
  fromControlId: string;
  toControlId: string;
};

export type CoverageMapping = {
  id: string;
  aiSystemId: string;
  controlId: string | null;
  status: ComplianceStatus;
  evidence: string | null;
  assessedAt: Date | string | null;
};

export type ControlCoverageStatus = ComplianceStatus | "INHERITED";

export type ControlCoverageRow = {
  control: CoverageControl;
  status: ControlCoverageStatus;
  source: "direct" | "crosswalk" | "none";
  mappingId: string | null;
  evidence: string | null;
  assessedAt: Date | string | null;
  /** Controls in other frameworks linked to this one (both directions). */
  crosswalk: CoverageControl[];
  /** Subset of `crosswalk` that is directly COMPLIANT and grants inheritance. */
  inheritedFrom: CoverageControl[];
};

export type CoverageSummary = {
  total: number;
  compliant: number;
  inherited: number;
  partiallyCompliant: number;
  nonCompliant: number;
  notAssessed: number;
  /** (compliant + inherited) / total, 0..100. 0 when total is 0. */
  coveragePct: number;
  /** Controls with any direct status other than NOT_ASSESSED, as % of total. */
  assessedPct: number;
};

export type SystemFrameworkCoverage = {
  framework: ComplianceFramework;
  rows: ControlCoverageRow[];
  summary: CoverageSummary;
};

/** Undirected adjacency: controlId -> set of crosswalked controlIds. */
export function buildCrosswalkIndex(pairs: CoverageCrosswalkPair[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    let set = index.get(a);
    if (!set) {
      set = new Set();
      index.set(a, set);
    }
    set.add(b);
  };
  for (const pair of pairs) {
    if (pair.fromControlId === pair.toControlId) continue;
    add(pair.fromControlId, pair.toControlId);
    add(pair.toControlId, pair.fromControlId);
  }
  return index;
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

export function summarizeRows(rows: ControlCoverageRow[]): CoverageSummary {
  const summary: CoverageSummary = {
    total: rows.length,
    compliant: 0,
    inherited: 0,
    partiallyCompliant: 0,
    nonCompliant: 0,
    notAssessed: 0,
    coveragePct: 0,
    assessedPct: 0,
  };
  for (const row of rows) {
    switch (row.status) {
      case "COMPLIANT":
        summary.compliant += 1;
        break;
      case "INHERITED":
        summary.inherited += 1;
        break;
      case "PARTIALLY_COMPLIANT":
        summary.partiallyCompliant += 1;
        break;
      case "NON_COMPLIANT":
        summary.nonCompliant += 1;
        break;
      default:
        summary.notAssessed += 1;
    }
  }
  summary.coveragePct = pct(summary.compliant + summary.inherited, summary.total);
  summary.assessedPct = pct(
    summary.compliant + summary.partiallyCompliant + summary.nonCompliant,
    summary.total
  );
  return summary;
}

/**
 * Coverage of one framework for one system.
 *
 * @param controls      Every catalog control (all frameworks) — needed so
 *                      crosswalked controls can be described.
 * @param crosswalk     Pre-built undirected index (see buildCrosswalkIndex).
 * @param mappings      The system's ComplianceMapping rows (any framework).
 */
export function computeSystemFrameworkCoverage(input: {
  framework: ComplianceFramework;
  controls: CoverageControl[];
  crosswalk: Map<string, Set<string>>;
  mappings: CoverageMapping[];
}): SystemFrameworkCoverage {
  const controlsById = new Map(input.controls.map((c) => [c.id, c]));
  const directByControl = new Map<string, CoverageMapping>();
  for (const mapping of input.mappings) {
    if (!mapping.controlId) continue;
    // Newest assessment wins if duplicates ever appear (the unique index
    // should prevent that, but be defensive).
    const existing = directByControl.get(mapping.controlId);
    if (!existing || toTime(mapping.assessedAt) > toTime(existing.assessedAt)) {
      directByControl.set(mapping.controlId, mapping);
    }
  }

  const frameworkControls = input.controls
    .filter((c) => c.framework === input.framework)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

  const rows: ControlCoverageRow[] = frameworkControls.map((control) => {
    const linkedIds = input.crosswalk.get(control.id) ?? new Set<string>();
    const crosswalk = Array.from(linkedIds)
      .map((id) => controlsById.get(id))
      .filter((c): c is CoverageControl => Boolean(c))
      .sort((a, b) => a.framework.localeCompare(b.framework) || a.sortOrder - b.sortOrder);

    const direct = directByControl.get(control.id);
    if (direct && direct.status !== "NOT_ASSESSED") {
      return {
        control,
        status: direct.status,
        source: "direct",
        mappingId: direct.id,
        evidence: direct.evidence,
        assessedAt: direct.assessedAt,
        crosswalk,
        inheritedFrom: [],
      };
    }

    const inheritedFrom = crosswalk.filter((linked) => {
      const linkedDirect = directByControl.get(linked.id);
      return linkedDirect?.status === "COMPLIANT";
    });

    if (inheritedFrom.length > 0) {
      return {
        control,
        status: "INHERITED",
        source: "crosswalk",
        mappingId: direct?.id ?? null,
        evidence: direct?.evidence ?? null,
        assessedAt: direct?.assessedAt ?? null,
        crosswalk,
        inheritedFrom,
      };
    }

    return {
      control,
      status: "NOT_ASSESSED",
      source: direct ? "direct" : "none",
      mappingId: direct?.id ?? null,
      evidence: direct?.evidence ?? null,
      assessedAt: direct?.assessedAt ?? null,
      crosswalk,
      inheritedFrom: [],
    };
  });

  return { framework: input.framework, rows, summary: summarizeRows(rows) };
}

export type OrgFrameworkCoverage = {
  framework: ComplianceFramework;
  controlCount: number;
  /** Systems with at least one direct mapping in this framework. */
  systemsInScope: number;
  /** Mean per-system coveragePct across systems in scope (0 when none). */
  avgCoveragePct: number;
  /** Distinct controls that are COMPLIANT or INHERITED on at least one system. */
  controlsSatisfiedSomewhere: number;
  perSystem: Array<{
    aiSystemId: string;
    summary: CoverageSummary;
  }>;
  /** Per control: how many in-scope systems satisfy it (direct or inherited). */
  perControl: Array<{
    control: CoverageControl;
    satisfiedSystems: number;
    assessedSystems: number;
  }>;
};

/**
 * Organisation-wide roll-up for one framework. Systems "in scope" are those
 * with at least one direct mapping in the framework; systems that have never
 * been assessed against it are excluded so an unstarted framework reads as
 * "0 systems in scope" rather than "0% coverage across everything".
 */
export function computeOrgFrameworkCoverage(input: {
  framework: ComplianceFramework;
  controls: CoverageControl[];
  crosswalk: Map<string, Set<string>>;
  mappings: CoverageMapping[];
}): OrgFrameworkCoverage {
  const frameworkControlIds = new Set(
    input.controls.filter((c) => c.framework === input.framework).map((c) => c.id)
  );
  const mappingsBySystem = new Map<string, CoverageMapping[]>();
  for (const mapping of input.mappings) {
    const list = mappingsBySystem.get(mapping.aiSystemId) ?? [];
    list.push(mapping);
    mappingsBySystem.set(mapping.aiSystemId, list);
  }

  const inScope = Array.from(mappingsBySystem.entries()).filter(([, rows]) =>
    rows.some((m) => m.controlId && frameworkControlIds.has(m.controlId))
  );

  const perSystem: OrgFrameworkCoverage["perSystem"] = [];
  const satisfiedCount = new Map<string, number>();
  const assessedCount = new Map<string, number>();
  let coverageSum = 0;

  for (const [aiSystemId, rows] of inScope) {
    const coverage = computeSystemFrameworkCoverage({
      framework: input.framework,
      controls: input.controls,
      crosswalk: input.crosswalk,
      mappings: rows,
    });
    perSystem.push({ aiSystemId, summary: coverage.summary });
    coverageSum += coverage.summary.coveragePct;
    for (const row of coverage.rows) {
      if (row.status === "COMPLIANT" || row.status === "INHERITED") {
        satisfiedCount.set(row.control.id, (satisfiedCount.get(row.control.id) ?? 0) + 1);
      }
      if (row.source === "direct" && row.status !== "NOT_ASSESSED") {
        assessedCount.set(row.control.id, (assessedCount.get(row.control.id) ?? 0) + 1);
      }
    }
  }

  const frameworkControls = input.controls
    .filter((c) => c.framework === input.framework)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));

  return {
    framework: input.framework,
    controlCount: frameworkControls.length,
    systemsInScope: inScope.length,
    avgCoveragePct: inScope.length ? Math.round(coverageSum / inScope.length) : 0,
    controlsSatisfiedSomewhere: satisfiedCount.size,
    perSystem,
    perControl: frameworkControls.map((control) => ({
      control,
      satisfiedSystems: satisfiedCount.get(control.id) ?? 0,
      assessedSystems: assessedCount.get(control.id) ?? 0,
    })),
  };
}

function toTime(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? 0 : t;
}
