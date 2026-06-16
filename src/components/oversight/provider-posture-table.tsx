"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";

export type ProviderPostureRow = {
  provider: string;
  totalCost: number;
  costPct: number;
  systemCount: number;
  highRiskCount: number;
  incidentCount: number;
  exceptionCount: number;
  alertCount: number;
  tokenVolume: number;
  requestCount: number;
};

interface ProviderPostureTableProps {
  rows: ProviderPostureRow[];
}

type SortKey = keyof ProviderPostureRow;

function getRiskTier(
  row: ProviderPostureRow
): "critical" | "high" | "medium" | "low" {
  const score =
    row.incidentCount * 10 +
    row.alertCount * 3 +
    row.highRiskCount * 5 +
    row.exceptionCount * 2;
  if (score >= 30) return "critical";
  if (score >= 15) return "high";
  if (score >= 5) return "medium";
  return "low";
}

export function ProviderPostureTable({ rows }: ProviderPostureTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("totalCost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = [...rows].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (typeof av === "number" && typeof bv === "number") {
      return sortDir === "desc" ? bv - av : av - bv;
    }
    return sortDir === "desc"
      ? String(bv).localeCompare(String(av))
      : String(av).localeCompare(String(bv));
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sortArrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "desc" ? " \u2193" : " \u2191") : "";

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-muted)]">
        No provider telemetry data available for comparison.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[var(--border-subtle)]">
            {[
              { key: "provider" as SortKey, label: "Provider", align: "left" },
              {
                key: "totalCost" as SortKey,
                label: "Total Cost",
                align: "right",
              },
              {
                key: "costPct" as SortKey,
                label: "% of Spend",
                align: "right",
              },
              {
                key: "tokenVolume" as SortKey,
                label: "Tokens",
                align: "right",
              },
              {
                key: "requestCount" as SortKey,
                label: "Requests",
                align: "right",
              },
              {
                key: "systemCount" as SortKey,
                label: "Systems",
                align: "right",
              },
              {
                key: "highRiskCount" as SortKey,
                label: "High Risk",
                align: "right",
              },
              {
                key: "incidentCount" as SortKey,
                label: "Incidents",
                align: "right",
              },
              {
                key: "exceptionCount" as SortKey,
                label: "Exceptions",
                align: "right",
              },
              {
                key: "alertCount" as SortKey,
                label: "Alerts",
                align: "right",
              },
            ].map((col) => (
              <th
                key={col.key}
                className={`px-3 py-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)] cursor-pointer hover:text-[var(--text-secondary)] transition-colors ${col.align === "right" ? "text-right" : "text-left"}`}
                onClick={() => handleSort(col.key)}
              >
                {col.label}
                {sortArrow(col.key)}
              </th>
            ))}
            <th className="px-3 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Risk Tier
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const tier = getRiskTier(row);
            return (
              <tr
                key={row.provider}
                className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-hover)] transition-colors"
              >
                <td className="px-3 py-3 font-medium capitalize">
                  {row.provider}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  ${row.totalCost.toFixed(2)}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.costPct.toFixed(1)}%
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.tokenVolume.toLocaleString("en-US")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.requestCount.toLocaleString("en-US")}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.systemCount}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.highRiskCount > 0 ? (
                    <span className="text-[var(--critical)]">
                      {row.highRiskCount}
                    </span>
                  ) : (
                    "0"
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.incidentCount > 0 ? (
                    <span className="text-[var(--high)]">
                      {row.incidentCount}
                    </span>
                  ) : (
                    "0"
                  )}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.exceptionCount}
                </td>
                <td className="px-3 py-3 text-right tabular-nums">
                  {row.alertCount}
                </td>
                <td className="px-3 py-3 text-right">
                  <Badge variant={tier}>{tier.toUpperCase()}</Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
