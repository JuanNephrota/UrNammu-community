/**
 * Prisma-backed loaders for the framework control catalog and coverage.
 * Thin IO layer over the pure functions in framework-coverage.ts.
 */

import type { ComplianceFramework } from "@prisma/client";
import { prisma } from "./prisma";
import { CATALOG_FRAMEWORKS, type CatalogFramework } from "./framework-catalog";
import {
  buildCrosswalkIndex,
  computeOrgFrameworkCoverage,
  computeSystemFrameworkCoverage,
  type CoverageControl,
  type CoverageCrosswalkPair,
  type CoverageMapping,
  type OrgFrameworkCoverage,
  type SystemFrameworkCoverage,
} from "./framework-coverage";

export type LoadedCatalog = {
  controls: CoverageControl[];
  pairs: CoverageCrosswalkPair[];
  crosswalk: Map<string, Set<string>>;
};

const CONTROL_SELECT = {
  id: true,
  framework: true,
  code: true,
  title: true,
  category: true,
  sortOrder: true,
} as const;

const MAPPING_SELECT = {
  id: true,
  aiSystemId: true,
  controlId: true,
  status: true,
  evidence: true,
  assessedAt: true,
} as const;

export async function loadCatalog(): Promise<LoadedCatalog> {
  const [controls, pairs] = await Promise.all([
    prisma.frameworkControl.findMany({
      select: CONTROL_SELECT,
      orderBy: [{ framework: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.controlCrosswalk.findMany({ select: { fromControlId: true, toControlId: true } }),
  ]);
  return { controls, pairs, crosswalk: buildCrosswalkIndex(pairs) };
}

/** Full control rows (with descriptions) for one framework — for the browser page. */
export async function loadFrameworkControls(framework: CatalogFramework) {
  return prisma.frameworkControl.findMany({
    where: { framework },
    orderBy: { sortOrder: "asc" },
  });
}

export async function loadSystemMappings(aiSystemId: string): Promise<CoverageMapping[]> {
  return prisma.complianceMapping.findMany({
    where: { aiSystemId, controlId: { not: null } },
    select: MAPPING_SELECT,
  });
}

/**
 * Coverage of every catalog framework for one system. One catalog load, one
 * mapping load, N in-memory computations.
 */
export async function loadSystemCoverage(
  aiSystemId: string,
  catalog?: LoadedCatalog
): Promise<Record<CatalogFramework, SystemFrameworkCoverage>> {
  const [cat, mappings] = await Promise.all([
    catalog ? Promise.resolve(catalog) : loadCatalog(),
    loadSystemMappings(aiSystemId),
  ]);
  const result = {} as Record<CatalogFramework, SystemFrameworkCoverage>;
  for (const framework of CATALOG_FRAMEWORKS) {
    result[framework] = computeSystemFrameworkCoverage({
      framework,
      controls: cat.controls,
      crosswalk: cat.crosswalk,
      mappings,
    });
  }
  return result;
}

export async function loadOrgCoverage(
  catalog?: LoadedCatalog
): Promise<Record<CatalogFramework, OrgFrameworkCoverage>> {
  const [cat, mappings] = await Promise.all([
    catalog ? Promise.resolve(catalog) : loadCatalog(),
    prisma.complianceMapping.findMany({
      where: { controlId: { not: null } },
      select: MAPPING_SELECT,
    }),
  ]);
  const result = {} as Record<CatalogFramework, OrgFrameworkCoverage>;
  for (const framework of CATALOG_FRAMEWORKS) {
    result[framework] = computeOrgFrameworkCoverage({
      framework,
      controls: cat.controls,
      crosswalk: cat.crosswalk,
      mappings,
    });
  }
  return result;
}

/** Picks the framework a system's Compliance tab should open on by default. */
export function pickDefaultFramework(
  coverage: Record<CatalogFramework, SystemFrameworkCoverage>,
  requested?: string | null
): CatalogFramework {
  if (requested && (CATALOG_FRAMEWORKS as string[]).includes(requested)) {
    return requested as CatalogFramework;
  }
  let best: CatalogFramework = CATALOG_FRAMEWORKS[0];
  let bestAssessed = -1;
  for (const framework of CATALOG_FRAMEWORKS) {
    const s = coverage[framework].summary;
    const assessed = s.compliant + s.partiallyCompliant + s.nonCompliant;
    if (assessed > bestAssessed) {
      bestAssessed = assessed;
      best = framework;
    }
  }
  return best;
}

export function frameworkLabelFromEnum(framework: ComplianceFramework): string {
  return framework.replace(/_/g, " ");
}
