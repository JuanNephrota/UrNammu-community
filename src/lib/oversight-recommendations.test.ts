import test from "node:test";
import assert from "node:assert/strict";
import { getOversightRecommendations } from "./oversight-recommendations";

test("prioritizes budget and investigation recommendations", () => {
  const recommendations = getOversightRecommendations({
    staleProviders: [],
    latestFailedSyncMessage: null,
    exposureFindingCount: 1,
    dangerousPromptAlertCount: 0,
    openInvestigations: 2,
    unattributedCoverageGapPct: 42,
    driftAlerts: 1,
    anomalyCount: 2,
    modelDriftCount: 1,
    budgetSummaries: [
      {
        id: "b1",
        scopeType: "PROVIDER",
        scopeKey: "openai",
        label: "OpenAI",
        monthlyBudget: 1000,
        currentSpend: 1200,
        utilizationPct: 120,
        warningThresholdPct: 80,
        pacingStatus: "critical",
        projectedMonthEndSpend: 1800,
      },
    ],
    recentAlerts: [],
  });

  assert.equal(recommendations[0]?.key, "budget-critical");
  assert.equal(recommendations.some((item) => item.key === "open-investigations"), true);
});
