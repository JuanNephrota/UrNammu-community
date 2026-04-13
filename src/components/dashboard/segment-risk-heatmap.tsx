"use client";

type SegmentRow = {
  label: string;
  systems: number;
  avgScore: number;
  highRisk: number;
};

function cellStyle(score: number) {
  if (score >= 80) return "bg-[var(--critical)]/20 text-[var(--critical)]";
  if (score >= 60) return "bg-orange-500/20 text-orange-200";
  if (score >= 40) return "bg-amber-500/20 text-amber-200";
  return "bg-emerald-500/15 text-emerald-200";
}

export function SegmentRiskHeatmap({
  title,
  rows,
}: {
  title: string;
  rows: SegmentRow[];
}) {
  return (
    <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4 shadow-lg shadow-black/20">
      <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">No segment data yet.</p>
      ) : (
        <div className="mt-4 space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_80px_80px_80px] items-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2 text-sm">
              <span className="truncate text-[var(--text-primary)]">{row.label}</span>
              <span className="text-center text-[var(--text-muted)]">{row.systems}</span>
              <span className={`rounded px-2 py-1 text-center text-xs font-semibold ${cellStyle(row.avgScore)}`}>
                {row.avgScore}
              </span>
              <span className="text-center text-[var(--text-muted)]">{row.highRisk}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
