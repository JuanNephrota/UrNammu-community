"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2 } from "lucide-react";
import { formatCell } from "@/lib/reports/export/format";
import type { ReportConfig, ReportDataSourceKey, ReportResult } from "@/lib/reports/types";

const PIE_COLORS = [
  "var(--accent)",
  "var(--info)",
  "var(--success)",
  "var(--warning)",
  "var(--high)",
  "var(--critical)",
  "var(--minimal)",
  "var(--medium)",
];

interface ReportPreviewProps {
  dataSource: ReportDataSourceKey;
  config: ReportConfig;
  // bumping this forces a refetch (e.g. when the builder applies edits)
  refreshKey?: number;
}

export function ReportPreview({ dataSource, config, refreshKey = 0 }: ReportPreviewProps) {
  const [result, setResult] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataSource, config }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Preview failed");
      setResult(data as ReportResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [dataSource, config]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  if (loading && !result) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-sm text-[var(--text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin" /> Running report…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-[var(--critical-border)] bg-[var(--critical-dim)] px-4 py-3 text-sm text-[var(--critical-strong)]">
        {error}
      </div>
    );
  }
  if (!result) return null;

  const showChart = result.grouped && result.chartType !== "none" && result.rows.length > 0;
  const groupKey = result.columns[0]?.key;
  const chartData = result.rows.map((r) => ({
    name: String(r[groupKey] ?? "—"),
    count: Number(r._count ?? 0),
  }));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
        <span className="font-medium text-[var(--text-secondary)]">{result.source.label}</span>
        <span>·</span>
        <span>{result.totalRows.toLocaleString("en-US")} rows</span>
        {result.grouped && <span>· grouped</span>}
        {result.dateRangeLabel && <span>· {result.dateRangeLabel}</span>}
        {loading && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>

      {showChart && (
        <div className="h-64 w-full rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4">
          <ResponsiveContainer width="100%" height="100%">
            {result.chartType === "pie" ? (
              <PieChart>
                <Pie data={chartData} dataKey="count" nameKey="name" outerRadius={90} label>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            ) : result.chartType === "line" ? (
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="count" stroke="var(--accent)" strokeWidth={2} />
              </LineChart>
            ) : (
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--bg-hover)" }} />
                <Bar dataKey="count" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-[var(--border-subtle)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]">
              {result.columns.map((c) => (
                <th
                  key={c.key}
                  className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] whitespace-nowrap"
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.length === 0 ? (
              <tr>
                <td colSpan={result.columns.length} className="h-24 text-center text-[var(--text-muted)]">
                  No data matched this report.
                </td>
              </tr>
            ) : (
              result.rows.map((row, ri) => (
                <tr
                  key={ri}
                  className="border-b border-[var(--border-subtle)] bg-[var(--bg-surface)]/50 hover:bg-[var(--bg-hover)] transition-colors"
                >
                  {result.columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-4 py-2.5 text-[var(--text-secondary)] whitespace-nowrap ${
                        c.type === "number" || c.type === "currency" ? "text-right tabular-nums" : ""
                      }`}
                    >
                      {formatCell(row[c.key] ?? null, c.type)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {result.totalRows > result.rows.length && (
        <p className="text-xs text-[var(--text-faint)]">
          Showing first {result.rows.length.toLocaleString("en-US")} of{" "}
          {result.totalRows.toLocaleString("en-US")} rows. Export for the full data set.
        </p>
      )}
    </div>
  );
}

const tooltipStyle = {
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-default)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--text-primary)",
};
