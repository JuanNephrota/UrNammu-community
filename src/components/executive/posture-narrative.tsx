"use client";

import type { PostureScore } from "@/lib/executive-posture";

function tierColor(tier: PostureScore["tier"]): string {
  if (tier === "strong") return "text-emerald-400";
  if (tier === "moderate") return "text-amber-400";
  return "text-red-400";
}

export function PostureNarrative({
  narrative,
  tier,
  generatedAt,
}: {
  narrative: string[];
  tier: PostureScore["tier"];
  generatedAt: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-default)] bg-[var(--bg-surface)] p-6 shadow-lg shadow-black/20">
      <div className="mb-4 flex items-center justify-between">
        <h3
          className="text-sm font-bold uppercase tracking-wider text-[var(--text-faint)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Executive Briefing
        </h3>
        <span className="text-[10px] text-[var(--text-faint)]">
          Generated {generatedAt}
        </span>
      </div>

      <div className="space-y-3">
        {narrative.map((paragraph, i) => (
          <p
            key={i}
            className={`text-sm leading-relaxed ${
              i === 0
                ? `font-semibold ${tierColor(tier)}`
                : "text-[var(--text-secondary)]"
            }`}
          >
            {paragraph}
          </p>
        ))}
      </div>

      <div className="mt-5 border-t border-[var(--border-subtle)] pt-4">
        <p className="text-[10px] text-[var(--text-faint)] italic">
          This summary is generated automatically from governance data. No AI
          model was used — all insights are derived directly from system
          metrics.
        </p>
      </div>
    </div>
  );
}
