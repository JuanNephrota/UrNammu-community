import Link from "next/link";
import { Hand, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HelpHint } from "@/components/help/help-hint";
import { formatDateTime } from "@/lib/utils";
import {
  describeTrigger,
  isEnforceableTrigger,
  triggerLabel,
  type HumanReviewEnforcement,
  type HumanReviewTrigger,
} from "@/lib/human-review-triggers";

export type HumanReviewMatchRow = {
  id: string;
  createdAt: Date | string;
  provider: string;
  model: string | null;
  mode: string;
  matches: Array<{ trigger: string; tool: string; detail: string }>;
};

const KIND_BADGE: Record<HumanReviewTrigger["kind"], string> = {
  tool: "tool",
  tool_argument: "argument",
  sensitive_data: "sensitive data",
  note: "note",
};

/**
 * What must stop for a person, how a match is handled, and the recent
 * matches both proxies recorded.
 */
export function HumanReviewCard({
  agent,
  triggers,
  enforcement,
  recentMatches,
  canEdit,
  pendingReviews,
}: {
  agent: { id: string; humanReviewRequired: boolean; autonomyLevel: string };
  triggers: HumanReviewTrigger[];
  enforcement: HumanReviewEnforcement;
  recentMatches: HumanReviewMatchRow[];
  canEdit: boolean;
  /** Withheld calls waiting for a reviewer. */
  pendingReviews?: number;
}) {
  const enforceable = triggers.filter(isEnforceableTrigger);
  const notes = triggers.filter((t) => t.kind === "note");
  const enforce = enforcement === "enforce";

  return (
    <Card id="human-review" className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Hand className="h-4 w-4 text-[var(--accent)]" />
            Human Review Triggers
            <HelpHint hint="human_review_triggers" />
          </span>
          <span className="flex items-center gap-2">
            <Badge variant={enforce ? "success" : "warning"}>{enforce ? "ENFORCE" : "MONITOR"}</Badge>
            {(pendingReviews ?? 0) > 0 && (
              <Link href={`/oversight/human-review?agentId=${agent.id}`} className="inline-flex">
                <Badge variant="critical">{pendingReviews} awaiting review</Badge>
              </Link>
            )}
            <Badge variant="outline">
              {enforceable.length} enforceable{notes.length ? ` · ${notes.length} note${notes.length === 1 ? "" : "s"}` : ""}
            </Badge>
            {canEdit && (
              <Link
                href={`/agents/${agent.id}/edit#human-review`}
                className="inline-flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
              >
                <Pencil className="h-3 w-3" /> Edit
              </Link>
            )}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-xs text-[var(--text-muted)]">
          {enforce ? (
            <>
              A matching tool call withholds the model&apos;s response at the proxy (403 human_review_required), queues it under{" "}
              <Link href={`/oversight/human-review?agentId=${agent.id}`} className="text-[var(--accent)] hover:underline">
                Human Review
              </Link>{" "}
              and raises a HIGH alert. Approving there lets the agent through when it re-runs the call. Streams are buffered until the model finishes.
            </>
          ) : (
            "A matching tool call is recorded as a dry-run denial and raises a HIGH alert; the response is forwarded. Switch to Enforce to hold it."
          )}
        </p>

        {triggers.length === 0 ? (
          <p className="text-[var(--text-muted)]">
            No triggers declared.
            {agent.humanReviewRequired ? " Human review is marked required, so declare what must stop for a person." : ""}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {triggers.map((trigger, index) => (
              <li
                key={index}
                className="flex flex-wrap items-center gap-2 rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] px-3 py-2"
              >
                <Badge variant={trigger.kind === "note" ? "outline" : "info"}>{KIND_BADGE[trigger.kind]}</Badge>
                <span className="font-medium text-[var(--text-primary)]">{triggerLabel(trigger)}</span>
                {trigger.kind !== "note" && trigger.label && (
                  <span className="text-xs text-[var(--text-faint)]">{describeTrigger(trigger)}</span>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">
            Recent matches
          </p>
          {recentMatches.length === 0 ? (
            <p className="text-[var(--text-muted)]">
              None recorded. Matches appear here and under{" "}
              <Link href="/compliance/denials" className="text-[var(--accent)] hover:underline">
                Compliance → Denials
              </Link>{" "}
              once the agent&apos;s traffic carries <code className="text-xs">x-agent-id</code>.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentMatches.map((row) => (
                <li key={row.id} className="rounded-md border border-[var(--border-subtle)] bg-[var(--bg-base)] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2">
                      <Badge variant={row.mode === "enforced" ? "critical" : "warning"}>
                        {row.mode === "enforced" ? "withheld" : "observed"}
                      </Badge>
                      <span className="text-xs text-[var(--text-muted)]">
                        {row.provider}
                        {row.model ? ` / ${row.model}` : ""}
                      </span>
                    </span>
                    <span className="text-xs text-[var(--text-faint)]">{formatDateTime(row.createdAt)}</span>
                  </div>
                  <ul className="mt-2 space-y-1 text-[var(--text-secondary)]">
                    {row.matches.map((m, i) => (
                      <li key={i}>
                        <span className="font-mono text-xs text-[var(--text-primary)]">{m.tool}</span> — {m.detail}{" "}
                        <span className="text-xs text-[var(--text-faint)]">({m.trigger})</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
