import { cn } from "@/lib/utils";

/**
 * Horizontal coverage bar. Segments: compliant (success), inherited (info),
 * partial (warning), non-compliant (critical); the remainder is unassessed.
 * All counts are absolute; the bar normalises to `total`.
 */
export function CoverageBar({
  total,
  compliant,
  inherited = 0,
  partiallyCompliant = 0,
  nonCompliant = 0,
  className,
  height = "h-2",
}: {
  total: number;
  compliant: number;
  inherited?: number;
  partiallyCompliant?: number;
  nonCompliant?: number;
  className?: string;
  height?: string;
}) {
  const pct = (n: number) => (total > 0 ? `${(n / total) * 100}%` : "0%");
  return (
    <div
      className={cn(
        "flex w-full overflow-hidden rounded-full bg-[var(--bg-elevated)] border border-[var(--border-subtle)]",
        height,
        className
      )}
      role="img"
      aria-label={`${compliant + inherited} of ${total} controls covered`}
    >
      <div className="bg-[var(--success)]" style={{ width: pct(compliant) }} />
      <div className="bg-[var(--info)]" style={{ width: pct(inherited) }} />
      <div className="bg-[var(--warning)]" style={{ width: pct(partiallyCompliant) }} />
      <div className="bg-[var(--critical)]" style={{ width: pct(nonCompliant) }} />
    </div>
  );
}

export function CoverageLegend({ className }: { className?: string }) {
  const items: Array<[string, string]> = [
    ["var(--success)", "Compliant"],
    ["var(--info)", "Inherited via crosswalk"],
    ["var(--warning)", "Partial"],
    ["var(--critical)", "Non-compliant"],
    ["var(--bg-elevated)", "Not assessed"],
  ];
  return (
    <div className={cn("flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--text-muted)]", className)}>
      {items.map(([color, label]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-sm border border-[var(--border-subtle)]"
            style={{ backgroundColor: color }}
          />
          {label}
        </span>
      ))}
    </div>
  );
}
