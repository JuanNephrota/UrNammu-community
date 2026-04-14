"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type UsageFilters = {
  startDate: string;
  endDate: string;
  provider: string;
  model: string;
  project: string;
};

interface UsageFiltersBarProps {
  filters: UsageFilters;
  filterOptions: {
    providers: string[];
    models: string[];
    projects: string[];
  };
  onFilterChange: (filters: UsageFilters) => void;
  loading?: boolean;
}

const PRESETS: { label: string; days: number | "ytd" }[] = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
  { label: "YTD", days: "ytd" },
];

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function getPresetRange(days: number | "ytd"): { start: string; end: string } {
  const now = new Date();
  const end = toISODate(now);
  if (days === "ytd") {
    return { start: `${now.getFullYear()}-01-01`, end };
  }
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return { start: toISODate(start), end };
}

export function UsageFiltersBar({
  filters,
  filterOptions,
  onFilterChange,
  loading,
}: UsageFiltersBarProps) {
  const [local, setLocal] = useState<UsageFilters>(filters);

  const applyPreset = useCallback(
    (days: number | "ytd") => {
      const { start, end } = getPresetRange(days);
      const next = { ...local, startDate: start, endDate: end };
      setLocal(next);
      onFilterChange(next);
    },
    [local, onFilterChange]
  );

  const handleChange = useCallback(
    (field: keyof UsageFilters, value: string) => {
      setLocal((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const handleApply = useCallback(() => {
    onFilterChange(local);
  }, [local, onFilterChange]);

  const handleReset = useCallback(() => {
    const { start, end } = getPresetRange(30);
    const reset: UsageFilters = {
      startDate: start,
      endDate: end,
      provider: "",
      model: "",
      project: "",
    };
    setLocal(reset);
    onFilterChange(reset);
  }, [onFilterChange]);

  const hasFilters = local.provider || local.model || local.project;

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-4">
      <div className="flex flex-wrap items-end gap-3">
        {/* Date range */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
            From
          </label>
          <input
            type="date"
            value={local.startDate}
            onChange={(e) => handleChange("startDate", e.target.value)}
            className="h-9 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
            To
          </label>
          <input
            type="date"
            value={local.endDate}
            onChange={(e) => handleChange("endDate", e.target.value)}
            className="h-9 rounded-md border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 text-xs text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          />
        </div>

        {/* Preset buttons */}
        <div className="flex gap-1">
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant="ghost"
              size="sm"
              className="h-9 px-2.5 text-xs"
              onClick={() => applyPreset(preset.days)}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        <div className="h-6 w-px bg-[var(--border-subtle)]" />

        {/* Provider filter */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
            Provider
          </label>
          <Select
            value={local.provider || "__all__"}
            onValueChange={(v) =>
              handleChange("provider", v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger className="h-9 w-[140px] text-xs">
              <SelectValue placeholder="All providers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All providers</SelectItem>
              {filterOptions.providers.map((p) => (
                <SelectItem key={p} value={p} className="capitalize">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Model filter */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
            Model
          </label>
          <Select
            value={local.model || "__all__"}
            onValueChange={(v) =>
              handleChange("model", v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger className="h-9 w-[180px] text-xs">
              <SelectValue placeholder="All models" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All models</SelectItem>
              {filterOptions.models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Project filter */}
        <div className="space-y-1">
          <label className="text-[11px] font-medium uppercase tracking-wider text-[var(--text-faint)]">
            Project
          </label>
          <Select
            value={local.project || "__all__"}
            onValueChange={(v) =>
              handleChange("project", v === "__all__" ? "" : v)
            }
          >
            <SelectTrigger className="h-9 w-[180px] text-xs">
              <SelectValue placeholder="All projects" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All projects</SelectItem>
              {filterOptions.projects.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex gap-2">
          <Button size="sm" className="h-9" onClick={handleApply} disabled={loading}>
            {loading ? "Loading..." : "Apply"}
          </Button>
          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs"
              onClick={handleReset}
            >
              Reset
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
