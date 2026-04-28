"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

export type PostureTrendPoint = {
  period: string;
  governanceScore: number;
  complianceRate: number;
  riskScore: number; // inverted: 100 - avgRisk so higher = better
  approved: number;
  ungoverned: number;
};

export function PostureTrendChart({
  data,
}: {
  data: PostureTrendPoint[];
}) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-muted)]">
        Not enough historical data to show posture trends yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="govScoreGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="complianceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="riskGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.2} />
            <stop offset="100%" stopColor="#f59e0b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="rgba(148, 163, 184, 0.06)"
        />
        <XAxis
          dataKey="period"
          tick={{ fontSize: 11, fill: "#64748b" }}
          stroke="rgba(148, 163, 184, 0.1)"
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: "#64748b" }}
          stroke="rgba(148, 163, 184, 0.1)"
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
        />
        <Legend wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} />
        <Area
          type="monotone"
          dataKey="governanceScore"
          name="Governance Score"
          stroke="#22d3ee"
          strokeWidth={2}
          fill="url(#govScoreGrad)"
        />
        <Area
          type="monotone"
          dataKey="complianceRate"
          name="Compliance %"
          stroke="#34d399"
          strokeWidth={2}
          fill="url(#complianceGrad)"
        />
        <Area
          type="monotone"
          dataKey="riskScore"
          name="Risk Health"
          stroke="#f59e0b"
          strokeWidth={2}
          fill="url(#riskGrad)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
