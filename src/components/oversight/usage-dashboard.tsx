"use client";

import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { UsageChart } from "@/components/dashboard/usage-chart";
import { UsageFiltersBar, type UsageFilters } from "./usage-filters";
import { CostBreakdownPanel } from "./cost-breakdown-panel";

type UsageApiResponse = {
  summary: {
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests: number;
    totalCost: number;
    costPerRequest: number;
    inputTokenCost: number;
    outputTokenCost: number;
    projectedMonthEndSpend: number | null;
    totalCacheTokens?: number;
    totalTokensWithCache?: number;
    totalInputTokensWithCache?: number;
    totalCacheReadTokens?: number;
    totalCacheCreationTokens?: number;
  };
  dailyUsage: { date: string; tokens: number; cost: number; cacheTokens?: number }[];
  dailyCostBreakdown: {
    date: string;
    inputCost: number;
    outputCost: number;
    totalCost: number;
  }[];
  topModels: {
    label: string;
    provider: string;
    tokens: number;
    cost: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cacheTokens?: number;
  }[];
  topProjects: {
    label: string;
    tokens: number;
    cost: number;
    providers: string[];
    cacheTokens?: number;
  }[];
  activityRows: {
    id: string;
    date: string;
    provider: string;
    model: string;
    attribution: string;
    requests: number;
    tokens: number;
    cost: number;
  }[];
  filterOptions: {
    providers: string[];
    models: string[];
    projects: string[];
  };
};

interface UsageDashboardProps {
  initialData: UsageApiResponse;
  initialFilters: UsageFilters;
}

function formatDate(date: Date | string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function UsageDashboard({
  initialData,
  initialFilters,
}: UsageDashboardProps) {
  const [data, setData] = useState<UsageApiResponse>(initialData);
  const [filters, setFilters] = useState<UsageFilters>(initialFilters);
  const [loading, setLoading] = useState(false);
  const [includeCached, setIncludeCached] = useState(false);

  const fetchData = useCallback(async (newFilters: UsageFilters) => {
    setFilters(newFilters);
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (newFilters.startDate) params.set("startDate", newFilters.startDate);
      if (newFilters.endDate) params.set("endDate", newFilters.endDate);
      if (newFilters.provider) params.set("provider", newFilters.provider);
      if (newFilters.model) params.set("model", newFilters.model);
      if (newFilters.project) params.set("project", newFilters.project);
      const res = await fetch(`/api/oversight/usage?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const { summary } = data;
  const hasCacheData = (summary.totalCacheTokens ?? 0) > 0;

  // When the "Include cached" toggle is on, show full totals;
  // otherwise show uncached only (the server-side default).
  const displayTokens = includeCached
    ? (summary.totalTokensWithCache ?? summary.totalTokens)
    : summary.totalTokens;
  const displayInputTokens = includeCached
    ? (summary.totalInputTokensWithCache ?? summary.totalInputTokens)
    : summary.totalInputTokens;

  return (
    <div className="space-y-6">
      {/* Filter bar */}
      <UsageFiltersBar
        filters={filters}
        filterOptions={data.filterOptions}
        onFilterChange={fetchData}
        loading={loading}
      />

      {/* Cache toggle — only shown when cache data exists */}
      {hasCacheData && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIncludeCached(!includeCached)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              includeCached ? "bg-[var(--accent)]" : "bg-[var(--bg-surface)]"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                includeCached ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
          <span className="text-sm text-[var(--text-secondary)]">
            Include cached tokens
          </span>
          {includeCached && (
            <Badge variant="info">
              {(summary.totalCacheTokens ?? 0).toLocaleString()} cache tokens included
            </Badge>
          )}
        </div>
      )}

      {/* Summary stats */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Token Volume
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {displayTokens.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {displayInputTokens.toLocaleString()} in /{" "}
              {summary.totalOutputTokens.toLocaleString()} out
              {hasCacheData && !includeCached && (
                <span className="text-[var(--text-faint)]"> (excl. cache)</span>
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Requests
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {summary.totalRequests.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Total tracked requests
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Total Cost
            </p>
            <p className="mt-2 text-3xl font-semibold">
              ${summary.totalCost.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              From provider cost buckets
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Cost / Request
            </p>
            <p className="mt-2 text-3xl font-semibold">
              ${summary.costPerRequest.toFixed(4)}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Average per request
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Month Forecast
            </p>
            <p className="mt-2 text-3xl font-semibold">
              {summary.projectedMonthEndSpend !== null
                ? `$${summary.projectedMonthEndSpend.toFixed(2)}`
                : "N/A"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Projected month-end spend
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Usage trend chart */}
      <Card>
        <CardHeader>
          <CardTitle>Usage Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <UsageChart
            data={
              includeCached
                ? data.dailyUsage.map((d) => ({
                    ...d,
                    tokens: d.tokens + (d.cacheTokens ?? 0),
                  }))
                : data.dailyUsage
            }
          />
        </CardContent>
      </Card>

      {/* Cost breakdown */}
      <CostBreakdownPanel
        summary={{
          totalCost: summary.totalCost,
          inputTokenCost: summary.inputTokenCost,
          outputTokenCost: summary.outputTokenCost,
          costPerRequest: summary.costPerRequest,
          totalInputTokens: summary.totalInputTokens,
          totalOutputTokens: summary.totalOutputTokens,
          totalRequests: summary.totalRequests,
          projectedMonthEndSpend: summary.projectedMonthEndSpend,
        }}
        dailyCostBreakdown={data.dailyCostBreakdown}
      />

      {/* Activity table + Top models/projects */}
      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Usage Activity</CardTitle>
          </CardHeader>
          <CardContent>
            {data.activityRows.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)]">
                No usage telemetry for the selected period.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-subtle)]">
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                        Date
                      </th>
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                        Provider
                      </th>
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                        Model
                      </th>
                      <th className="px-3 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                        Project / Actor
                      </th>
                      <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                        Requests
                      </th>
                      <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                        Tokens
                      </th>
                      <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                        Cost
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.activityRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-[var(--border-subtle)]"
                      >
                        <td className="px-3 py-3 text-xs text-[var(--text-faint)] whitespace-nowrap">
                          {formatDate(row.date)}
                        </td>
                        <td className="px-3 py-3">
                          <Badge variant="info" className="capitalize">
                            {row.provider}
                          </Badge>
                        </td>
                        <td className="px-3 py-3 font-mono text-xs text-[var(--text-secondary)]">
                          {row.model}
                        </td>
                        <td className="px-3 py-3 text-[var(--text-secondary)]">
                          {row.attribution}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {row.requests.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          {row.tokens.toLocaleString()}
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">
                          ${row.cost.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Top Models</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.topModels.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  No model-level telemetry.
                </p>
              ) : (
                data.topModels.map((item) => {
                  const displayModelTokens = includeCached
                    ? item.tokens + (item.cacheTokens ?? 0)
                    : item.tokens;
                  return (
                  <div
                    key={`${item.provider}:${item.label}`}
                    className="rounded-lg border border-[var(--border-subtle)] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-[var(--text-faint)] capitalize">
                          {item.provider} · {item.requests.toLocaleString()} req
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">
                          {displayModelTokens.toLocaleString()}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          ${item.cost.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Projects and Actors</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {data.topProjects.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  No project or actor attribution.
                </p>
              ) : (
                data.topProjects.map((item) => {
                  const displayProjTokens = includeCached
                    ? item.tokens + (item.cacheTokens ?? 0)
                    : item.tokens;
                  return (
                  <div
                    key={item.label}
                    className="rounded-lg border border-[var(--border-subtle)] p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-[var(--text-faint)]">
                          {item.providers.join(", ")}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">
                          {displayProjTokens.toLocaleString()}
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          ${item.cost.toFixed(2)}
                        </p>
                      </div>
                    </div>
                  </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
