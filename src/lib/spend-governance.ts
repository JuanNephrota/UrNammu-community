export type SpendBudgetSummary = {
  id: string;
  scopeType: "PROVIDER" | "AI_SYSTEM" | "DEPARTMENT";
  scopeKey: string;
  label: string;
  monthlyBudget: number;
  currentSpend: number;
  utilizationPct: number;
  warningThresholdPct: number;
  pacingStatus: "on_track" | "warning" | "critical";
  projectedMonthEndSpend: number;
};

export type TopCostDriver = {
  label: string;
  scopeType: "provider" | "system" | "department";
  amount: number;
};

export function summarizeSpendBudgets(input: {
    budgets: Array<{
      id: string;
      scopeType: "PROVIDER" | "AI_SYSTEM" | "DEPARTMENT";
    scopeKey: string;
    label: string;
    monthlyBudget: number;
    warningThresholdPct: number;
  }>;
  spendByScope: Map<string, number>;
  now?: Date;
}): SpendBudgetSummary[] {
  const now = input.now ?? new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const currentDay = Math.min(daysInMonth, now.getDate());
  const elapsedPct = currentDay / daysInMonth;

  return input.budgets
    .map((budget) => {
      const scopeId = `${budget.scopeType}:${budget.scopeKey}`;
      const currentSpend = input.spendByScope.get(scopeId) ?? 0;
      const utilizationPct = budget.monthlyBudget > 0 ? (currentSpend / budget.monthlyBudget) * 100 : 0;
      const projectedMonthEndSpend = elapsedPct > 0 ? currentSpend / elapsedPct : currentSpend;
      const pacingStatus: SpendBudgetSummary["pacingStatus"] =
        utilizationPct >= 100 || projectedMonthEndSpend >= budget.monthlyBudget
          ? "critical"
          : utilizationPct >= budget.warningThresholdPct
            ? "warning"
            : "on_track";

      return {
        ...budget,
        currentSpend,
        utilizationPct,
        pacingStatus,
        projectedMonthEndSpend,
      };
    })
    .sort((a, b) => b.utilizationPct - a.utilizationPct);
}

export function getTopCostDrivers(input: {
  providerTotals: Record<string, number>;
  systemTotals: Array<{ label: string; amount: number }>;
  departmentTotals: Array<{ label: string; amount: number }>;
  take?: number;
}): TopCostDriver[] {
  const items: TopCostDriver[] = [
    ...Object.entries(input.providerTotals).map(([label, amount]) => ({
      label,
      scopeType: "provider" as const,
      amount,
    })),
    ...input.systemTotals.map((entry) => ({
      label: entry.label,
      scopeType: "system" as const,
      amount: entry.amount,
    })),
    ...input.departmentTotals.map((entry) => ({
      label: entry.label,
      scopeType: "department" as const,
      amount: entry.amount,
    })),
  ];

  return items.sort((a, b) => b.amount - a.amount).slice(0, input.take ?? 8);
}
