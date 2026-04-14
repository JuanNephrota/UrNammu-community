"use client";

import type { PostureScore } from "@/lib/executive-posture";

function scoreColor(score: number): string {
  if (score >= 75) return "#34d399"; // emerald
  if (score >= 50) return "#f59e0b"; // amber
  return "#ef4444"; // red
}

function tierLabel(tier: PostureScore["tier"]): string {
  if (tier === "strong") return "Strong";
  if (tier === "moderate") return "Moderate";
  return "Needs Attention";
}

export function PostureScorecard({ score }: { score: PostureScore }) {
  const color = scoreColor(score.score);
  const radius = 80;
  const circumference = 2 * Math.PI * radius;
  const progress = (score.score / 100) * circumference;
  const offset = circumference - progress;

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-8 shadow-lg shadow-black/20">
      {/* Arc gauge */}
      <div className="relative">
        <svg width="200" height="200" viewBox="0 0 200 200">
          {/* Background circle */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke="rgba(148, 163, 184, 0.08)"
            strokeWidth="12"
          />
          {/* Progress arc */}
          <circle
            cx="100"
            cy="100"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 100 100)"
            style={{
              filter: `drop-shadow(0 0 8px ${color}40)`,
              transition: "stroke-dashoffset 1s ease-in-out",
            }}
          />
          {/* Center text */}
          <text
            x="100"
            y="92"
            textAnchor="middle"
            fill={color}
            fontSize="42"
            fontWeight="700"
            fontFamily="var(--font-display)"
          >
            {score.score}
          </text>
          <text
            x="100"
            y="115"
            textAnchor="middle"
            fill="#64748b"
            fontSize="13"
          >
            out of 100
          </text>
        </svg>
      </div>

      {/* Tier label */}
      <div className="text-center">
        <p
          className="text-lg font-bold"
          style={{ color, fontFamily: "var(--font-display)" }}
        >
          {tierLabel(score.tier)}
        </p>

        {/* Delta badge */}
        {score.delta !== 0 && (
          <span
            className={`mt-2 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${
              score.delta > 0
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-red-500/15 text-red-300"
            }`}
          >
            {score.delta > 0 ? "\u2191" : "\u2193"} {Math.abs(score.delta)} pts
            vs prior period
          </span>
        )}
      </div>

      {/* Dimension breakdown */}
      <div className="mt-2 w-full space-y-2">
        {score.dimensions.map((dim) => (
          <div key={dim.key} className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-secondary)]">
                {dim.label}{" "}
                <span className="text-[var(--text-faint)]">
                  ({Math.round(dim.weight * 100)}%)
                </span>
              </span>
              <span
                className="font-semibold"
                style={{ color: scoreColor(dim.score) }}
              >
                {dim.score}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-[var(--bg-deep)]">
              <div
                className="h-1.5 rounded-full transition-all duration-700"
                style={{
                  width: `${dim.score}%`,
                  backgroundColor: scoreColor(dim.score),
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
