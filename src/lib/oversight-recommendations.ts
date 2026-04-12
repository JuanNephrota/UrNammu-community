import type { AlertSeverity } from "@prisma/client";
import type { SpendBudgetSummary } from "./spend-governance";

export type OversightRecommendation = {
  key: string;
  title: string;
  detail: string;
  href: string;
  tone: "critical" | "warning" | "info" | "success";
  priority: number;
};

function pushUnique(items: OversightRecommendation[], recommendation: OversightRecommendation) {
  if (items.some((item) => item.key === recommendation.key)) return;
  items.push(recommendation);
}

export function getOversightRecommendations(input: {
  staleProviders: string[];
  latestFailedSyncMessage?: string | null;
  exposureFindingCount: number;
  openInvestigations: number;
  unattributedCoverageGapPct: number;
  driftAlerts: number;
  budgetSummaries: SpendBudgetSummary[];
  recentAlerts: Array<{ severity: AlertSeverity; title: string }>;
}) {
  const recommendations: OversightRecommendation[] = [];

  if (input.budgetSummaries.some((budget) => budget.pacingStatus === "critical")) {
    const critical = input.budgetSummaries.find((budget) => budget.pacingStatus === "critical");
    pushUnique(recommendations, {
      key: "budget-critical",
      title: "Budget threshold exceeded",
      detail: `${critical?.label ?? "A spend budget"} is pacing above plan and should be investigated immediately.`,
      href: "/oversight",
      tone: "critical",
      priority: 100,
    });
  }

  if (input.openInvestigations > 0) {
    pushUnique(recommendations, {
      key: "open-investigations",
      title: "Investigations need follow-through",
      detail: `${input.openInvestigations} investigation${input.openInvestigations === 1 ? "" : "s"} remain open.`,
      href: "/oversight/investigations",
      tone: "warning",
      priority: 95,
    });
  }

  if (input.exposureFindingCount > 0) {
    pushUnique(recommendations, {
      key: "exposure-findings",
      title: "Review restricted-data exposure signals",
      detail: `${input.exposureFindingCount} provider-visible telemetry finding${input.exposureFindingCount === 1 ? "" : "s"} suggest sensitive-data handling.`,
      href: "/oversight/usage",
      tone: "critical",
      priority: 90,
    });
  }

  if (input.unattributedCoverageGapPct >= 30) {
    pushUnique(recommendations, {
      key: "attribution-gap",
      title: "Link more telemetry to governed systems",
      detail: `${input.unattributedCoverageGapPct}% of recent token volume is still unattributed.`,
      href: "/oversight/usage",
      tone: "warning",
      priority: 80,
    });
  }

  if (input.staleProviders.length > 0 || input.latestFailedSyncMessage) {
    pushUnique(recommendations, {
      key: "sync-health",
      title: "Restore provider telemetry health",
      detail:
        input.latestFailedSyncMessage ??
        `Provider sync coverage is stale for ${input.staleProviders.join(", ")}.`,
      href: "/settings/provider-admin",
      tone: "warning",
      priority: 75,
    });
  }

  if (input.driftAlerts > 0) {
    pushUnique(recommendations, {
      key: "drift-alerts",
      title: "Review model or system drift alerts",
      detail: `${input.driftAlerts} drift alert${input.driftAlerts === 1 ? "" : "s"} may require reassessment.`,
      href: "/alerts",
      tone: "warning",
      priority: 70,
    });
  }

  if (
    recommendations.length === 0 &&
    input.recentAlerts.every((alert) => alert.severity === "LOW" || alert.severity === "INFO")
  ) {
    pushUnique(recommendations, {
      key: "healthy",
      title: "Oversight posture is stable",
      detail: "No major spend, sync, or exposure issues need intervention right now.",
      href: "/oversight",
      tone: "success",
      priority: 10,
    });
  }

  return recommendations.sort((a, b) => b.priority - a.priority);
}
