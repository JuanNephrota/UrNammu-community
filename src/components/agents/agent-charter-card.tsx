import Link from "next/link";
import { Pencil, ScrollText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpHint } from "@/components/help/help-hint";
import { getCharterStatus } from "@/lib/agent-governance";

/**
 * The agent charter: what the agent is for, what it may and may not do, the
 * limits it must respect, and how success is measured. Required before
 * approval (docs/plans/agentic-governance-playbook.md §2).
 */
export function AgentCharterCard({
  agent,
  canEdit,
}: {
  agent: {
    id: string;
    purpose: string | null;
    inScopeActions: string[];
    outOfScopeActions: string[];
    decisionBoundaries: string | null;
    successCriteria: string | null;
  };
  canEdit: boolean;
}) {
  const status = getCharterStatus(agent);
  const chip = (text: string, tone: "in" | "out") => (
    <span
      key={`${tone}-${text}`}
      className={
        tone === "in"
          ? "rounded-full bg-[var(--success-dim)] px-3 py-1 text-xs font-medium text-[var(--success-strong)]"
          : "rounded-full bg-[var(--critical-dim)] px-3 py-1 text-xs font-medium text-[var(--critical-strong)]"
      }
    >
      {text}
    </span>
  );
  const empty = (text: string) => <p className="text-sm text-[var(--text-muted)]">{text}</p>;

  return (
    <Card id="charter" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-[var(--accent)]" />
            Agent Charter
            <HelpHint hint="agent_charter" />
          </span>
          <span className="flex items-center gap-2">
            <Badge variant={status.complete ? "success" : "warning"}>
              {status.complete ? "Complete" : `Missing ${status.missing.join(", ")}`}
            </Badge>
            {canEdit && (
              <Link
                href={`/agents/${agent.id}/edit#charter`}
                className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
              >
                <Pencil className="h-3 w-3" /> Edit
              </Link>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <section className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Purpose</p>
          {agent.purpose?.trim() ? (
            <p className="leading-relaxed text-[var(--text-secondary)]">{agent.purpose}</p>
          ) : (
            empty("Not defined. What business outcome does this agent exist to produce?")
          )}
        </section>
        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              In-scope actions
            </p>
            {agent.inScopeActions.length > 0 ? (
              <div className="flex flex-wrap gap-2">{agent.inScopeActions.map((a) => chip(a, "in"))}</div>
            ) : (
              empty("None listed. What may the agent do on its own?")
            )}
          </section>
          <section className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
              Out-of-scope actions
            </p>
            {agent.outOfScopeActions.length > 0 ? (
              <div className="flex flex-wrap gap-2">{agent.outOfScopeActions.map((a) => chip(a, "out"))}</div>
            ) : (
              empty("None listed. What must it never do, even if asked?")
            )}
          </section>
        </div>
        <section className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Decision boundaries
          </p>
          {agent.decisionBoundaries?.trim() ? (
            <p className="whitespace-pre-line leading-relaxed text-[var(--text-secondary)]">{agent.decisionBoundaries}</p>
          ) : (
            empty("Not defined. Thresholds, data classes or situations where it must stop and hand off.")
          )}
        </section>
        <section className="space-y-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Success criteria
          </p>
          {agent.successCriteria?.trim() ? (
            <p className="whitespace-pre-line leading-relaxed text-[var(--text-secondary)]">{agent.successCriteria}</p>
          ) : (
            empty("Not defined. How will you know it is working, and when would you retire it?")
          )}
        </section>
      </CardContent>
    </Card>
  );
}
