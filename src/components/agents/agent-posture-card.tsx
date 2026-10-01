import Link from "next/link";
import { Compass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpHint } from "@/components/help/help-hint";
import type { AgentPosture, PostureTier } from "@/lib/agent-posture";

export const TIER_LABEL: Record<PostureTier, string> = { strong: "Strong", developing: "Developing", weak: "Weak" };
export const TIER_VARIANT: Record<PostureTier, "success" | "warning" | "critical"> = {
  strong: "success",
  developing: "warning",
  weak: "critical",
};

const STATUS_BAR: Record<"strong" | "partial" | "weak", string> = {
  strong: "bg-[var(--success)]",
  partial: "bg-[var(--warning)]",
  weak: "bg-[var(--critical)]",
};

/**
 * The six governance-by-design dimensions, scored from the agent's record.
 * Descriptive, not a gate: it shows where governance is real and where it
 * is still paperwork.
 */
export function AgentPostureCard({ posture, className }: { posture: AgentPosture; className?: string }) {
  return (
    <Card id="posture" className={`scroll-mt-6 ${className ?? ""}`}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-[var(--accent)]" />
            Governance Posture
            <HelpHint hint="agent_posture" />
          </span>
          <span className="flex items-center gap-2">
            <span className="text-2xl font-semibold tabular-nums text-[var(--text-primary)]">{posture.overall}</span>
            <Badge variant={TIER_VARIANT[posture.tier]}>{TIER_LABEL[posture.tier]}</Badge>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3 md:grid-cols-2">
          {posture.dimensions.map((d) => (
            <li key={d.key} className="rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[var(--text-primary)]">{d.label}</p>
                  <p className="text-[11px] text-[var(--text-faint)]">{d.question}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums text-[var(--text-primary)]">{d.score}</span>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--bg-elevated)]"
                role="progressbar"
                aria-valuenow={d.score}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${d.label} ${d.score} of 100`}
              >
                <div className={`h-full rounded-full ${STATUS_BAR[d.status]}`} style={{ width: `${d.score}%` }} />
              </div>
              {d.gaps.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {d.gaps.slice(0, 3).map((g, i) => (
                    <li key={i} className="text-xs">
                      <Link href={g.href} className="text-[var(--text-secondary)] underline-offset-2 hover:text-[var(--accent)] hover:underline">
                        {g.text}
                      </Link>
                    </li>
                  ))}
                  {d.gaps.length > 3 && (
                    <li className="text-[11px] text-[var(--text-faint)]">+{d.gaps.length - 3} more</li>
                  )}
                </ul>
              ) : (
                <p className="mt-2 text-xs text-[var(--success-strong)]">{d.evidence.slice(0, 2).join(" · ")}</p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
