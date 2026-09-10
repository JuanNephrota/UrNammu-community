import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SessionTraceWaterfall } from "@/components/oversight/session-trace-waterfall";
import { surfaceLabel } from "@/lib/claude-code-events";
import { formatElapsed, loadSessionTrace } from "@/lib/claude-code-traces";

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm tabular-nums text-[var(--text-primary)]">
        {value}
      </div>
    </div>
  );
}

export default async function ClaudeCodeSessionTracePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const decoded = decodeURIComponent(sessionId);
  const { trace, truncated } = await loadSessionTrace(decoded);

  if (!trace) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Session Trace"
        description="Turns, model calls, and tool use in execution order. Spans are derived from OTel event timing — metadata only, no prompt or code content."
      />

      <Link
        href="/oversight/claude-code/sessions"
        className="inline-block text-xs font-medium text-[var(--accent)] hover:underline"
      >
        ← Back to session traces
      </Link>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
                Session
              </div>
              <div className="mt-0.5 font-mono text-sm text-[var(--text-primary)]">
                {trace.sessionId}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {trace.userEmail ?? "unattributed"} ·{" "}
                {trace.entrypoint === "local-agent"
                  ? "Cowork"
                  : surfaceLabel(trace.entrypoint)}{" "}
                · {trace.startedAt.toLocaleString("en-US")}
              </div>
            </div>
            <div className="flex flex-wrap gap-6">
              <Stat
                label="Active"
                value={formatElapsed(trace.totalMs)}
                hint="Time actually spent working, with idle gaps elided — this is the waterfall's scale."
              />
              <Stat
                label="Elapsed"
                value={formatElapsed(trace.wallClockMs)}
                hint="Wall-clock time from first to last event, including idle gaps (sessions get resumed)."
              />
              <Stat label="Turns" value={String(trace.turnCount)} />
              <Stat label="Events" value={String(trace.eventCount)} />
              <Stat label="Errors" value={String(trace.errorCount)} />
              <Stat label="Flagged" value={String(trace.flaggedCount)} />
            </div>
          </div>

          {(trace.flaggedCount > 0 ||
            trace.root.clamped ||
            trace.idleGaps.length > 0) && (
            <div className="mt-4 flex flex-wrap gap-2">
              {trace.flaggedCount > 0 && (
                <Badge variant="critical">
                  {trace.flaggedCount} flagged prompt
                  {trace.flaggedCount === 1 ? "" : "s"} in this session
                </Badge>
              )}
              {trace.root.clamped && (
                <Badge variant="outline">
                  some span durations clamped for display
                </Badge>
              )}
              {trace.idleGaps.length > 0 && (
                <Badge variant="outline">
                  {trace.idleGaps.length} idle gap
                  {trace.idleGaps.length === 1 ? "" : "s"} elided from the
                  timeline
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="overflow-x-auto pt-6">
          <SessionTraceWaterfall trace={trace} truncated={truncated} />
        </CardContent>
      </Card>

      <p className="text-xs text-[var(--text-faint)]">
        Claude Code&apos;s OTel exporter emits metrics and events, not spans —
        this trace is assembled at query time from the event stream (session →
        turn → event, timed by each event&apos;s reported duration). Sessions
        are often resumed over hours or days, so the timeline plots active time
        and elides long idle gaps.
      </p>
    </div>
  );
}
