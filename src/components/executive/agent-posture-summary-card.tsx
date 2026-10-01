import Link from "next/link";
import { Compass } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TIER_LABEL, TIER_VARIANT } from "@/components/agents/agent-posture-card";
import type { PosturePortfolio } from "@/lib/agent-posture";

/** Portfolio view of agent governance posture for the executive page. */
export function AgentPostureSummaryCard({ portfolio }: { portfolio: PosturePortfolio }) {
  const bar = (n: number) => (portfolio.agents === 0 ? 0 : Math.round((n / portfolio.agents) * 100));
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Compass className="h-4 w-4 text-[var(--accent)]" />
            Agent Governance Posture
          </span>
          <span className="flex items-center gap-2">
            <span className="text-2xl font-semibold tabular-nums">{portfolio.average}</span>
            <span className="text-xs text-[var(--text-muted)]">
              avg across {portfolio.agents} agent{portfolio.agents === 1 ? "" : "s"}
            </span>
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {portfolio.agents === 0 ? (
          <p className="text-sm text-[var(--text-muted)]">No active agents registered.</p>
        ) : (
          <>
            <div className="flex h-2 overflow-hidden rounded-full bg-[var(--bg-elevated)]" aria-hidden>
              <div className="bg-[var(--success)]" style={{ width: `${bar(portfolio.tiers.strong)}%` }} />
              <div className="bg-[var(--warning)]" style={{ width: `${bar(portfolio.tiers.developing)}%` }} />
              <div className="bg-[var(--critical)]" style={{ width: `${bar(portfolio.tiers.weak)}%` }} />
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="success">{portfolio.tiers.strong} strong</Badge>
              <Badge variant="warning">{portfolio.tiers.developing} developing</Badge>
              <Badge variant="critical">{portfolio.tiers.weak} weak</Badge>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  Dimensions, weakest first
                </p>
                <ul className="mt-2 space-y-1.5">
                  {portfolio.dimensions.map((d) => (
                    <li key={d.key} className="flex items-center gap-2 text-sm">
                      <span className="w-32 text-[var(--text-secondary)]">{d.label}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-elevated)]">
                        <span
                          className={`block h-full rounded-full ${d.average >= 80 ? "bg-[var(--success)]" : d.average >= 50 ? "bg-[var(--warning)]" : "bg-[var(--critical)]"}`}
                          style={{ width: `${d.average}%` }}
                        />
                      </span>
                      <span className="w-8 text-right text-xs tabular-nums text-[var(--text-muted)]">{d.average}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
                  Agents needing attention
                </p>
                <ul className="mt-2 space-y-1.5">
                  {portfolio.weakestAgents.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/agents/${a.id}#posture`}
                        className="flex items-center justify-between rounded-md border border-[var(--border-subtle)] px-3 py-2 text-sm hover:bg-[var(--bg-hover)]"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-[var(--text-primary)]">{a.name}</span>
                          <span className="text-[11px] text-[var(--text-muted)]">weakest: {a.weakest}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold tabular-nums">{a.overall}</span>
                          <Badge variant={TIER_VARIANT[a.tier]}>{TIER_LABEL[a.tier]}</Badge>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
