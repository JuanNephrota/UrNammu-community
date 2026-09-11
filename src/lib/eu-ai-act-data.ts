/**
 * Prisma-backed helpers for the EU AI Act classification. Kept separate from
 * eu-ai-act.ts so the classification logic stays pure and testable.
 */

import type { EuAiActRiskTier } from "@prisma/client";
import { prisma } from "./prisma";
import type { SystemFrameworkCoverage } from "./framework-coverage";

export const EU_AI_ACT_ALERT_SOURCE = "eu_ai_act";

/** Shape consumed by approval blockers and governance recommendations. */
export type EuAiActGovernanceInput = {
  classified: boolean;
  tier: EuAiActRiskTier | null;
  /** Applicable articles with no direct or inherited satisfaction yet. */
  unassessedObligations: number;
  applicableArticles: number;
};

export const UNCLASSIFIED_EU_AI_ACT: EuAiActGovernanceInput = {
  classified: false,
  tier: null,
  unassessedObligations: 0,
  applicableArticles: 0,
};

/**
 * Derives the governance input from an already-loaded classification and the
 * system's EU AI Act coverage rows (see loadSystemCoverage). Used by the
 * registry detail page, which has both in hand.
 */
export function buildEuAiActGovernanceInput(
  classification: { tier: EuAiActRiskTier; applicableArticles: string[] } | null,
  euCoverage: SystemFrameworkCoverage | null
): EuAiActGovernanceInput {
  if (!classification) return UNCLASSIFIED_EU_AI_ACT;
  const applicable = new Set(classification.applicableArticles);
  let unassessed = 0;
  for (const row of euCoverage?.rows ?? []) {
    if (!applicable.has(row.control.code)) continue;
    if (row.status === "NOT_ASSESSED") unassessed += 1;
  }
  return {
    classified: true,
    tier: classification.tier,
    unassessedObligations: unassessed,
    applicableArticles: applicable.size,
  };
}

/**
 * Loads the governance input from the database for callers that have not
 * already loaded coverage (the approval API). Counts NOT_ASSESSED mappings
 * against applicable articles; crosswalk inheritance is ignored here because
 * the approval decision should rest on direct EU AI Act evidence.
 */
export async function loadEuAiActGovernanceInput(aiSystemId: string): Promise<EuAiActGovernanceInput> {
  const classification = await prisma.euAiActClassification.findUnique({
    where: { aiSystemId },
    select: { tier: true, applicableArticles: true },
  });
  if (!classification) return UNCLASSIFIED_EU_AI_ACT;

  const assessed = await prisma.complianceMapping.findMany({
    where: {
      aiSystemId,
      framework: "EU_AI_ACT",
      status: { not: "NOT_ASSESSED" },
      control: { code: { in: classification.applicableArticles } },
    },
    select: { control: { select: { code: true } } },
  });
  const assessedCodes = new Set(assessed.map((m) => m.control?.code).filter(Boolean));
  const unassessed = classification.applicableArticles.filter((code) => !assessedCodes.has(code)).length;

  return {
    classified: true,
    tier: classification.tier,
    unassessedObligations: unassessed,
    applicableArticles: classification.applicableArticles.length,
  };
}
