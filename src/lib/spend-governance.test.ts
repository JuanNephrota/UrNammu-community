import test from "node:test";
import assert from "node:assert/strict";
import { getTopCostDrivers, summarizeSpendBudgets } from "./spend-governance";

test("summarizes budget utilization and projected pacing", () => {
  const summaries = summarizeSpendBudgets({
    budgets: [
      {
        id: "budget-1",
        scopeType: "PROVIDER",
        scopeKey: "openai",
        label: "OpenAI",
        monthlyBudget: 1000,
        warningThresholdPct: 80,
      },
    ],
    spendByScope: new Map([["PROVIDER:openai", 900]]),
    now: new Date("2026-04-15T12:00:00Z"),
  });

  assert.equal(summaries[0]?.pacingStatus, "critical");
  assert.equal(Math.round(summaries[0]?.utilizationPct ?? 0), 90);
});

test("returns the highest cost drivers across scopes", () => {
  const drivers = getTopCostDrivers({
    providerTotals: { openai: 1200, anthropic: 900 },
    systemTotals: [{ label: "Payroll Copilot", amount: 1500 }],
    departmentTotals: [{ label: "Finance", amount: 800 }],
    take: 2,
  });

  assert.equal(drivers.length, 2);
  assert.equal(drivers[0]?.label, "Payroll Copilot");
  assert.equal(drivers[1]?.label, "openai");
});
