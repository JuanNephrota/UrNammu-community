"use client";

interface RiskHeatMapProps {
  data: {
    systemName: string;
    biasScore: number;
    securityScore: number;
    privacyScore: number;
    fairnessScore: number;
    performanceScore: number;
    transparencyScore: number;
  }[];
}

const dimensions = [
  "biasScore",
  "securityScore",
  "privacyScore",
  "fairnessScore",
  "performanceScore",
  "transparencyScore",
] as const;

const dimensionLabels: Record<string, string> = {
  biasScore: "Bias",
  securityScore: "Security",
  privacyScore: "Privacy",
  fairnessScore: "Fairness",
  performanceScore: "Perform.",
  transparencyScore: "Transp.",
};

function scoreStyle(score: number): { bg: string; text: string; glow: string } {
  if (score >= 80) return {
    bg: "rgba(239, 68, 68, 0.25)",
    text: "#fca5a5",
    glow: "0 0 12px rgba(239, 68, 68, 0.3)",
  };
  if (score >= 60) return {
    bg: "rgba(249, 115, 22, 0.2)",
    text: "#fdba74",
    glow: "0 0 10px rgba(249, 115, 22, 0.2)",
  };
  if (score >= 40) return {
    bg: "rgba(234, 179, 8, 0.15)",
    text: "#fde047",
    glow: "0 0 8px rgba(234, 179, 8, 0.15)",
  };
  if (score >= 20) return {
    bg: "rgba(34, 197, 94, 0.12)",
    text: "#86efac",
    glow: "none",
  };
  return {
    bg: "rgba(34, 197, 94, 0.08)",
    text: "#6ee7b7",
    glow: "none",
  };
}

export function RiskHeatMap({ data }: RiskHeatMapProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)] py-8 text-center">
        No risk assessments to display.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="text-left px-3 py-3 text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
              System
            </th>
            {dimensions.map((d) => (
              <th key={d} className="px-2 py-3 text-center text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                {dimensionLabels[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={row.systemName}
              className="border-t border-[var(--border-subtle)] animate-fade-in-up"
              style={{ animationDelay: `${i * 80}ms` }}
            >
              <td className="px-3 py-3 font-medium text-[var(--text-primary)] whitespace-nowrap text-[13px]">
                {row.systemName}
              </td>
              {dimensions.map((d) => {
                const score = row[d];
                const style = scoreStyle(score);
                return (
                  <td key={d} className="px-2 py-3 text-center">
                    <span
                      className="inline-flex items-center justify-center w-12 h-8 rounded-md text-xs font-bold tabular-nums transition-all hover:scale-110"
                      style={{
                        backgroundColor: style.bg,
                        color: style.text,
                        boxShadow: style.glow,
                      }}
                    >
                      {score}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
