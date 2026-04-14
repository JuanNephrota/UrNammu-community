"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

interface TrendAssessment {
  id: string;
  createdAt: Date | string;
  overallScore: number;
  biasScore: number;
  securityScore: number;
  privacyScore: number;
  fairnessScore: number;
  performanceScore: number;
  transparencyScore: number;
  residualOverallScore?: number | null;
}

interface SystemRiskTrendChartProps {
  assessments: TrendAssessment[];
  height?: number;
}

const dimensionLines = [
  { key: "biasScore", label: "Bias", color: "#f87171" },
  { key: "securityScore", label: "Security", color: "#fb923c" },
  { key: "privacyScore", label: "Privacy", color: "#a78bfa" },
  { key: "fairnessScore", label: "Fairness", color: "#facc15" },
  { key: "performanceScore", label: "Performance", color: "#34d399" },
  { key: "transparencyScore", label: "Transparency", color: "#60a5fa" },
] as const;

const tooltipStyle = {
  backgroundColor: "#111827",
  border: "1px solid rgba(148, 163, 184, 0.12)",
  borderRadius: "8px",
  color: "#e2e8f0",
  fontSize: "12px",
  boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
};

function formatDate(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export function SystemRiskTrendChart({ assessments, height = 300 }: SystemRiskTrendChartProps) {
  if (assessments.length < 2) {
    return (
      <p className="py-8 text-center text-sm text-[var(--text-muted)]">
        {assessments.length === 0
          ? "No assessments recorded yet."
          : "At least 2 assessments are needed to show a trend."}
      </p>
    );
  }

  const hasResidual = assessments.some((a) => a.residualOverallScore != null);

  // Oldest first for left-to-right chronology
  const sorted = [...assessments].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const data = sorted.map((a) => ({
    date: formatDate(a.createdAt),
    Overall: a.overallScore,
    ...(hasResidual && a.residualOverallScore != null
      ? { "Residual Overall": a.residualOverallScore }
      : {}),
    ...Object.fromEntries(dimensionLines.map((d) => [d.label, a[d.key]])),
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148, 163, 184, 0.06)" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 10, fill: "#64748b" }}
          stroke="rgba(148, 163, 184, 0.1)"
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fontSize: 10, fill: "#64748b" }}
          stroke="rgba(148, 163, 184, 0.1)"
          label={{
            value: "Score",
            angle: -90,
            position: "insideLeft",
            style: { fontSize: 10, fill: "#64748b" },
          }}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value) => (typeof value === "number" ? value.toFixed(1) : value)}
        />
        <Legend wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }} iconType="circle" iconSize={8} />

        {/* Overall score — primary thick line */}
        <Line
          type="monotone"
          dataKey="Overall"
          stroke="#22d3ee"
          strokeWidth={2.5}
          dot={{ r: 3, fill: "#22d3ee" }}
          activeDot={{ r: 5 }}
        />

        {/* Residual overall — dashed green */}
        {hasResidual && (
          <Line
            type="monotone"
            dataKey="Residual Overall"
            stroke="#4ade80"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={{ r: 2, fill: "#4ade80" }}
          />
        )}

        {/* Per-dimension lines — thin, muted */}
        {dimensionLines.map((d) => (
          <Line
            key={d.key}
            type="monotone"
            dataKey={d.label}
            stroke={d.color}
            strokeWidth={1}
            strokeOpacity={0.6}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
