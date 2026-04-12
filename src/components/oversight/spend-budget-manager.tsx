"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Budget = {
  id: string;
  scopeType: "PROVIDER" | "AI_SYSTEM" | "DEPARTMENT";
  scopeKey: string;
  label: string;
  monthlyBudget: number;
  warningThresholdPct: number;
};

export function SpendBudgetManager({ budgets }: { budgets: Budget[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    scopeType: "PROVIDER" as Budget["scopeType"],
    scopeKey: "",
    label: "",
    monthlyBudget: "",
    warningThresholdPct: "80",
  });
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!form.scopeKey || !form.label || !form.monthlyBudget) return;
    setSaving(true);
    try {
      await fetch("/api/spend-budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scopeType: form.scopeType,
          scopeKey: form.scopeKey,
          label: form.label,
          monthlyBudget: Number(form.monthlyBudget),
          warningThresholdPct: Number(form.warningThresholdPct),
        }),
      });
      setForm({
        scopeType: "PROVIDER",
        scopeKey: "",
        label: "",
        monthlyBudget: "",
        warningThresholdPct: "80",
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-5">
        <select
          value={form.scopeType}
          onChange={(e) => setForm((current) => ({ ...current, scopeType: e.target.value as Budget["scopeType"] }))}
          className="h-9 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-sm text-[var(--text-primary)]"
        >
          <option value="PROVIDER">Provider</option>
          <option value="AI_SYSTEM">AI System</option>
          <option value="DEPARTMENT">Department</option>
        </select>
        <Input
          value={form.scopeKey}
          onChange={(e) => setForm((current) => ({ ...current, scopeKey: e.target.value }))}
          placeholder="Scope key"
        />
        <Input
          value={form.label}
          onChange={(e) => setForm((current) => ({ ...current, label: e.target.value }))}
          placeholder="Display label"
        />
        <Input
          type="number"
          min="1"
          value={form.monthlyBudget}
          onChange={(e) => setForm((current) => ({ ...current, monthlyBudget: e.target.value }))}
          placeholder="Monthly budget"
        />
        <div className="flex gap-2">
          <Input
            type="number"
            min="1"
            max="100"
            value={form.warningThresholdPct}
            onChange={(e) => setForm((current) => ({ ...current, warningThresholdPct: e.target.value }))}
            placeholder="Warn %"
          />
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {budgets.length > 0 && (
        <div className="space-y-2">
          {budgets.map((budget) => (
            <div
              key={budget.id}
              className="flex items-center justify-between rounded-lg border border-[var(--border-subtle)] p-3 text-sm"
            >
              <div>
                <p className="font-medium text-[var(--text-primary)]">{budget.label}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  {budget.scopeType.replace("_", " ")} · {budget.scopeKey}
                </p>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                ${budget.monthlyBudget.toFixed(2)} / {budget.warningThresholdPct}% warn
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
