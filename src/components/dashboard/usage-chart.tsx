"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface UsageChartProps {
  data: { date: string; tokens: number; cost: number }[];
}

export function UsageChart({ data }: UsageChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-8 text-center">
        No usage data in the last 30 days.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="tokenGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.06)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#64748b" }}
          tickFormatter={(v) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          stroke="rgba(148, 163, 184, 0.1)"
        />
        <YAxis
          tick={{ fontSize: 10, fill: "#64748b" }}
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
          formatter={(value, name) => {
            const num = Number(value);
            return name === "cost" ? `$${num.toFixed(2)}` : num.toLocaleString();
          }}
        />
        <Area
          type="monotone"
          dataKey="tokens"
          stroke="#22d3ee"
          strokeWidth={2}
          fill="url(#tokenGradient)"
          name="Tokens"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
