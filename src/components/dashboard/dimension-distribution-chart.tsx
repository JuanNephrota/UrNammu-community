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

interface DimensionDistributionProps {
  data: {
    dimension: string;
    Minimal: number;
    Low: number;
    Medium: number;
    High: number;
    Critical: number;
  }[];
}

const bucketColors = {
  Minimal: "#6ee7b7",
  Low: "#86efac",
  Medium: "#fde047",
  High: "#fdba74",
  Critical: "#fca5a5",
};

const tooltipStyle = {
  backgroundColor: "#111827",
  border: "1px solid rgba(148, 163, 184, 0.12)",
  borderRadius: "8px",
  color: "#e2e8f0",
  fontSize: "12px",
  boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
};

export function DimensionDistributionChart({ data }: DimensionDistributionProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-8 text-center">
        No risk assessments to display.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} barCategoryGap="20%">
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.06)" />
        <XAxis
          dataKey="dimension"
          tick={{ fontSize: 11, fill: "#64748b" }}
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
        <Tooltip contentStyle={tooltipStyle} />
        <Legend
          wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }}
          iconType="square"
          iconSize={10}
        />
        {(Object.keys(bucketColors) as (keyof typeof bucketColors)[]).map((bucket) => (
          <Bar
            key={bucket}
            dataKey={bucket}
            fill={bucketColors[bucket]}
            fillOpacity={0.85}
            radius={[2, 2, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
