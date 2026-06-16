"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface CostBreakdownPanelProps {
  summary: {
    totalCost: number;
    inputTokenCost: number;
    outputTokenCost: number;
    costPerRequest: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests: number;
    projectedMonthEndSpend: number | null;
  };
  dailyCostBreakdown: {
    date: string;
    inputCost: number;
    outputCost: number;
    totalCost: number;
  }[];
}

export function CostBreakdownPanel({
  summary,
  dailyCostBreakdown,
}: CostBreakdownPanelProps) {
  const forecastStatus =
    summary.projectedMonthEndSpend !== null
      ? summary.projectedMonthEndSpend > summary.totalCost * 2
        ? "critical"
        : summary.projectedMonthEndSpend > summary.totalCost * 1.3
          ? "warning"
          : "on_track"
      : null;

  return (
    <div className="space-y-4">
      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Input Token Cost
            </p>
            <p className="mt-2 text-2xl font-semibold">
              ${summary.inputTokenCost.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {summary.totalInputTokens.toLocaleString("en-US")} input tokens
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Output Token Cost
            </p>
            <p className="mt-2 text-2xl font-semibold">
              ${summary.outputTokenCost.toFixed(2)}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {summary.totalOutputTokens.toLocaleString("en-US")} output tokens
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Avg Cost / Request
            </p>
            <p className="mt-2 text-2xl font-semibold">
              ${summary.costPerRequest.toFixed(4)}
            </p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {summary.totalRequests.toLocaleString("en-US")} total requests
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-xs uppercase tracking-wider text-[var(--text-faint)]">
              Monthly Forecast
            </p>
            <p className="mt-2 text-2xl font-semibold">
              {summary.projectedMonthEndSpend !== null
                ? `$${summary.projectedMonthEndSpend.toFixed(2)}`
                : "N/A"}
            </p>
            <div className="mt-1 flex items-center gap-2">
              <p className="text-xs text-[var(--text-muted)]">
                Projected month-end
              </p>
              {forecastStatus && (
                <Badge
                  variant={
                    forecastStatus === "critical"
                      ? "critical"
                      : forecastStatus === "warning"
                        ? "warning"
                        : "success"
                  }
                >
                  {forecastStatus === "critical"
                    ? "Over pace"
                    : forecastStatus === "warning"
                      ? "Trending high"
                      : "On track"}
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Stacked bar chart: daily cost by input vs output */}
      <Card>
        <CardHeader>
          <CardTitle>Daily Cost Breakdown: Input vs Output Tokens</CardTitle>
        </CardHeader>
        <CardContent>
          {dailyCostBreakdown.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-muted)]">
              No cost data for the selected period.
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={dailyCostBreakdown}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="rgba(148, 163, 184, 0.06)"
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  tickFormatter={(v) =>
                    new Date(v).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })
                  }
                  stroke="rgba(148, 163, 184, 0.1)"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#64748b" }}
                  stroke="rgba(148, 163, 184, 0.1)"
                  tickFormatter={(v) => `$${v.toFixed(2)}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111827",
                    border: "1px solid rgba(148, 163, 184, 0.12)",
                    borderRadius: "8px",
                    color: "#e2e8f0",
                    fontSize: "12px",
                    boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
                  }}
                  formatter={(value, name) => [
                    `$${Number(value).toFixed(4)}`,
                    String(name),
                  ]}
                />
                <Legend
                  wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }}
                  iconType="square"
                />
                <Bar
                  dataKey="inputCost"
                  name="Input Token Cost"
                  stackId="cost"
                  fill="#22d3ee"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="outputCost"
                  name="Output Token Cost"
                  stackId="cost"
                  fill="#a78bfa"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
