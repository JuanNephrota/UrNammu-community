"use client";

import { cn } from "@/lib/utils";
import type { BoardMetric } from "@/lib/executive-posture";

const variantStyles: Record<
  BoardMetric["variant"],
  { border: string; accent: string; glow: string }
> = {
  success: {
    border: "rgba(16, 185, 129, 0.15)",
    accent: "#34d399",
    glow: "shadow-emerald-500/10",
  },
  warning: {
    border: "rgba(245, 158, 11, 0.15)",
    accent: "#f59e0b",
    glow: "shadow-amber-500/10",
  },
  danger: {
    border: "rgba(239, 68, 68, 0.15)",
    accent: "#ef4444",
    glow: "shadow-red-500/10",
  },
  info: {
    border: "rgba(34, 211, 238, 0.15)",
    accent: "#22d3ee",
    glow: "shadow-cyan-500/10",
  },
  default: {
    border: "var(--border-subtle)",
    accent: "#94a3b8",
    glow: "",
  },
};

export function BoardSummaryCards({
  metrics,
}: {
  metrics: BoardMetric[];
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {metrics.map((metric) => {
        const style = variantStyles[metric.variant];
        return (
          <div
            key={metric.label}
            className={cn(
              "group relative rounded-xl bg-[var(--bg-surface)] p-5 transition-all duration-300 hover:-translate-y-0.5 shadow-lg shadow-black/20",
              style.glow && `shadow-[0_0_30px_-5px] ${style.glow}`
            )}
            style={{
              borderWidth: 1,
              borderStyle: "solid",
              borderColor: style.border,
            }}
          >
            {/* Top accent line */}
            <div
              className="absolute inset-x-0 top-0 h-px rounded-t-xl"
              style={{
                background: `linear-gradient(90deg, transparent, ${style.accent}, transparent)`,
                opacity: 0.5,
              }}
            />

            <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              {metric.label}
            </p>
            <p
              className="mt-2 text-3xl font-bold tracking-tight text-[var(--text-primary)] tabular-nums"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {metric.value}
            </p>

            {metric.delta !== null && (
              <p
                className={cn(
                  "mt-1.5 text-xs font-medium",
                  metric.delta > 0
                    ? "text-emerald-400"
                    : metric.delta < 0
                      ? "text-red-400"
                      : "text-[var(--text-muted)]"
                )}
              >
                {metric.delta > 0 ? "+" : ""}
                {metric.delta} {metric.deltaLabel}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
