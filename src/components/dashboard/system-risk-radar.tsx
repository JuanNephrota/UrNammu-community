"use client";

import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";

interface RadarAssessment {
  biasScore: number;
  securityScore: number;
  privacyScore: number;
  fairnessScore: number;
  performanceScore: number;
  transparencyScore: number;
  residualBiasScore?: number | null;
  residualSecurityScore?: number | null;
  residualPrivacyScore?: number | null;
  residualFairnessScore?: number | null;
  residualPerformanceScore?: number | null;
  residualTransparencyScore?: number | null;
  createdAt?: Date | string;
}

interface SystemRiskRadarProps {
  /** Current (most recent) assessment */
  current: RadarAssessment;
  /** Previous assessment for comparison overlay — optional */
  previous?: RadarAssessment | null;
  height?: number;
}

const DIMS = [
  { key: "biasScore" as const, residualKey: "residualBiasScore" as const, label: "Bias" },
  { key: "securityScore" as const, residualKey: "residualSecurityScore" as const, label: "Security" },
  { key: "privacyScore" as const, residualKey: "residualPrivacyScore" as const, label: "Privacy" },
  { key: "fairnessScore" as const, residualKey: "residualFairnessScore" as const, label: "Fairness" },
  { key: "performanceScore" as const, residualKey: "residualPerformanceScore" as const, label: "Performance" },
  { key: "transparencyScore" as const, residualKey: "residualTransparencyScore" as const, label: "Transparency" },
];

const tooltipStyle = {
  backgroundColor: "#111827",
  border: "1px solid rgba(148, 163, 184, 0.12)",
  borderRadius: "8px",
  color: "#e2e8f0",
  fontSize: "12px",
  boxShadow: "0 10px 40px rgba(0,0,0,0.4)",
};

export function SystemRiskRadar({ current, previous, height = 320 }: SystemRiskRadarProps) {
  const hasResidual = DIMS.some((d) => current[d.residualKey] != null);

  const data = DIMS.map((d) => {
    const row: Record<string, string | number> = {
      dimension: d.label,
      Inherent: current[d.key],
    };
    if (hasResidual) {
      row["Residual"] = current[d.residualKey] ?? current[d.key];
    }
    if (previous) {
      row["Previous"] = previous[d.key];
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <RadarChart data={data} margin={{ top: 10, right: 30, bottom: 10, left: 30 }}>
        <PolarGrid stroke="rgba(148, 163, 184, 0.1)" />
        <PolarAngleAxis
          dataKey="dimension"
          tick={{ fontSize: 11, fill: "#94a3b8" }}
        />
        <PolarRadiusAxis
          angle={90}
          domain={[0, 100]}
          tickCount={5}
          tick={{ fontSize: 9, fill: "#64748b" }}
          stroke="rgba(148, 163, 184, 0.08)"
        />
        <Tooltip contentStyle={tooltipStyle} />
        {previous && (
          <Radar
            name="Previous"
            dataKey="Previous"
            stroke="#64748b"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            fill="#64748b"
            fillOpacity={0.08}
          />
        )}
        <Radar
          name="Inherent"
          dataKey="Inherent"
          stroke="#22d3ee"
          strokeWidth={2}
          fill="#22d3ee"
          fillOpacity={0.2}
        />
        {hasResidual && (
          <Radar
            name="Residual"
            dataKey="Residual"
            stroke="#4ade80"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            fill="#4ade80"
            fillOpacity={0.15}
          />
        )}
        {(previous || hasResidual) && (
          <Legend
            wrapperStyle={{ fontSize: "11px", color: "#94a3b8" }}
            iconType="circle"
            iconSize={8}
          />
        )}
      </RadarChart>
    </ResponsiveContainer>
  );
}
