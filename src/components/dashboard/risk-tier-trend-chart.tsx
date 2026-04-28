"use client";

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface RiskTierTrendProps {
  data: {
    date: string;
    CRITICAL: number;
    HIGH: number;
    MEDIUM: number;
    LOW: number;
    MINIMAL: number;
  }[];
}

const tierConfig = [
  { key: "CRITICAL", color: "#ef4444", label: "Critical" },
  { key: "HIGH", color: "#f97316", label: "High" },
  { key: "MEDIUM", color: "#eab308", label: "Medium" },
  { key: "LOW", color: "#22c55e", label: "Low" },
  { key: "MINIMAL", color: "#22d3ee", label: "Minimal" },
] as const;

const tooltipStyle = {
  backgroundColor: "#111827",
  border: "1px solid rgba(148, 163, 184, 0.12)",
  borderRadius: "8px",
  color: "#e2e8f0",
  fontSize: "12px",
  boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
};

export function RiskTierTrendChart({ data }: RiskTierTrendProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-8 text-center">
        No risk assessment history to display.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data}>
        <defs>
          {tierConfig.map(({ key, color }) => (
            <linearGradient key={key} id={`grad-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0.05} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.06)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#64748b" }}
          tickFormatter={(v) =>
            new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          }
          stroke="rgba(148, 163, 184, 0.1)"
        />
        <YAxis
          allowDecimals={false}
          tick={{ fontSize: 10, fill: "#64748b" }}
          stroke="rgba(148, 163, 184, 0.1)"
          label={{
            value: "Systems",
            angle: -90,
            position: "insideLeft",
            style: { fontSize: 10, fill: "#64748b" },
          }}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(v) =>
            new Date(v).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          }
        />
        <Legend
          wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }}
          iconType="square"
          iconSize={10}
        />
        {tierConfig.map(({ key, color, label }) => (
          <Area
            key={key}
            type="monotone"
            dataKey={key}
            name={label}
            stackId="1"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#grad-${key})`}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
