import { Badge } from "@/components/ui/badge";
import { formatMs } from "@/lib/claude-code-events";
import { formatElapsed } from "@/lib/claude-code-traces";
import type {
  IdleGap,
  SessionTrace,
  SpanStatus,
  TraceSpan,
} from "@/lib/claude-code-traces";

// Renders a synthesized session trace as a waterfall. Server component: turn
// collapsing uses native <details>, so the whole view ships without JS.

// Number of gridlines / axis labels across the timeline.
const AXIS_TICKS = 5;
// Floor on a bar's rendered width so a 2ms span is still visible.
const MIN_BAR_PCT = 0.35;
// Above this many turns the trace opens collapsed, to keep the page scannable.
const AUTO_COLLAPSE_ABOVE = 8;
// Minimum spacing between two *labelled* gaps, as a share of the timeline. A
// month-long session has 50+ gaps; labelling every one smears them into an
// unreadable line. Every gap still gets a band and a tooltip.
const MIN_GAP_LABEL_SPACING_PCT = 7;
// Row layout: [320px label][gap-3][flex-1 track][gap-3][96px duration]
// [gap-3][160px detail, lg only]. The backdrop is absolutely positioned, so it
// has to restate that geometry to sit under the track column exactly.
const TRACK_INSET = "left-[332px] right-[108px] lg:right-[280px]";

function barColor(span: TraceSpan): string {
  switch (span.status) {
    case "flagged":
      return "var(--critical-strong)";
    case "error":
      return "var(--warning-strong)";
    case "denied":
      return "var(--high-strong)";
  }
  if (span.kind === "proxy") return "var(--high-strong)";
  switch (span.eventName) {
    case "api_request":
    case "assistant_response":
      return "var(--accent)";
    case "tool_result":
    case "tool_decision":
      return "var(--info)";
    case "user_prompt":
      return "var(--text-primary)";
    default:
      return "var(--text-faint)";
  }
}

function statusBadge(status: SpanStatus, riskSeverity: string | null) {
  if (status === "flagged") {
    return (
      <Badge variant={riskSeverity === "critical" ? "critical" : "warning"}>
        {riskSeverity ?? "flagged"}
      </Badge>
    );
  }
  if (status === "error") return <Badge variant="warning">error</Badge>;
  if (status === "denied") return <Badge variant="high">denied</Badge>;
  return null;
}

/**
 * Gridlines and elided-gap bands for the whole waterfall, drawn once behind
 * every row.
 *
 * These are purely decorative, and they used to render per-row. That does not
 * scale: a 1500-event trace with 60 resume gaps produced 92,000 band elements,
 * 7MB of HTML and a 55-second load. One shared layer costs a fixed ~65
 * elements instead. It is inset to line up with the track column of the rows
 * in front of it, and takes no pointer events so row hover still works — the
 * per-gap durations live on the axis markers, which are few and hoverable.
 */
function TimelineBackdrop({
  idleGaps,
  totalMs,
}: {
  idleGaps: IdleGap[];
  totalMs: number;
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-y-0 ${TRACK_INSET}`}
      aria-hidden="true"
    >
      {Array.from({ length: AXIS_TICKS - 1 }, (_, i) => (
        <div
          key={i}
          className="absolute top-0 bottom-0 w-px bg-[var(--border-subtle)]"
          style={{ left: `${((i + 1) / AXIS_TICKS) * 100}%` }}
        />
      ))}
      {idleGaps.map((g) => (
        <div
          key={g.atMs}
          className="absolute top-0 bottom-0"
          style={{
            left: `${(g.atMs / totalMs) * 100}%`,
            width: `${(g.renderMs / totalMs) * 100}%`,
            background:
              "repeating-linear-gradient(45deg, var(--bg-elevated) 0 3px, transparent 3px 6px)",
            borderLeft: "1px dashed var(--border-strong)",
            borderRight: "1px dashed var(--border-strong)",
          }}
        />
      ))}
    </div>
  );
}

/** One timeline track with a single positioned bar. */
function Track({ span, totalMs }: { span: TraceSpan; totalMs: number }) {
  const left = (span.startMs / totalMs) * 100;
  const rawWidth = ((span.endMs - span.startMs) / totalMs) * 100;
  const width = Math.max(rawWidth, MIN_BAR_PCT);
  const color = barColor(span);
  const label = span.instant
    ? "instant"
    : [
        formatMs(span.endMs - span.startMs),
        span.clamped ? "(clamped)" : "",
        span.clipped ? "· bar pinned to keep order" : "",
      ]
        .filter(Boolean)
        .join(" ");

  return (
    <div className="relative h-4 flex-1">
      {span.instant ? (
        <div
          className="absolute top-0.5 h-3 w-[2px] rounded-sm"
          style={{ left: `min(${left}%, calc(100% - 2px))`, background: color }}
          title={`+${formatMs(span.startMs)} · instant`}
        />
      ) : (
        <div
          className="absolute top-1 h-2 rounded-sm"
          style={{
            left: `${Math.min(left, 100 - MIN_BAR_PCT)}%`,
            width: `${Math.min(width, 100 - Math.min(left, 100 - MIN_BAR_PCT))}%`,
            background: color,
            opacity: span.kind === "turn" ? 0.45 : 1,
          }}
          title={`+${formatMs(span.startMs)} → +${formatMs(span.endMs)} · ${label}`}
        />
      )}
    </div>
  );
}

/** Fixed-width label column + track, shared by every row in the waterfall. */
function SpanRow({
  span,
  totalMs,
  indent,
}: {
  span: TraceSpan;
  totalMs: number;
  indent: number;
}) {
  return (
    <div className="flex items-center gap-3 py-[3px] hover:bg-[var(--bg-hover)]">
      <div
        className="flex min-w-0 shrink-0 items-center gap-2"
        style={{ width: 320, paddingLeft: indent * 14 }}
      >
        <span className="truncate font-mono text-[11px] text-[var(--text-primary)]">
          {span.name}
        </span>
        {span.toolName && (
          <span className="shrink-0 truncate font-mono text-[10px] text-[var(--text-muted)]">
            {span.toolName}
          </span>
        )}
        {statusBadge(span.status, span.riskSeverity)}
      </div>

      <Track span={span} totalMs={totalMs} />

      <div className="w-24 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--text-muted)]">
        {span.instant
          ? "·"
          : formatMs(span.reportedMs ?? span.endMs - span.startMs)}
        {span.clipped && span.kind === "event" && (
          <span
            className="ml-0.5 text-[var(--text-faint)]"
            title="Reported duration; the bar was pinned forward to keep the trace in order."
          >
            *
          </span>
        )}
      </div>
      <div className="hidden w-40 shrink-0 truncate text-[10px] text-[var(--text-faint)] lg:block">
        {span.detail}
      </div>
    </div>
  );
}

/** A turn: a <details> whose summary row is the rolled-up turn span. */
function TurnRow({
  span,
  totalMs,
  defaultOpen,
}: {
  span: TraceSpan;
  totalMs: number;
  defaultOpen: boolean;
}) {
  // Always expand a turn that contains something a reviewer needs to see.
  const open =
    defaultOpen || span.status === "flagged" || span.status === "error";

  return (
    <details open={open} className="group">
      <summary className="cursor-pointer list-none border-t border-[var(--border-subtle)] marker:content-none">
        <div className="flex items-center gap-3 py-[3px] hover:bg-[var(--bg-hover)]">
          <div
            className="flex min-w-0 shrink-0 items-center gap-2"
            style={{ width: 320 }}
          >
            <span className="w-3 shrink-0 text-center text-[9px] text-[var(--text-faint)]">
              <span className="group-open:hidden">▸</span>
              <span className="hidden group-open:inline">▾</span>
            </span>
            <span className="truncate text-[11px] font-semibold text-[var(--text-primary)]">
              {span.name}
            </span>
            <span className="shrink-0 text-[10px] text-[var(--text-faint)]">
              {span.children.length} events
            </span>
            {statusBadge(span.status, span.riskSeverity)}
          </div>

          <Track span={span} totalMs={totalMs} />

          <div className="w-24 shrink-0 text-right font-mono text-[10px] tabular-nums text-[var(--text-secondary)]">
            {formatMs(span.endMs - span.startMs)}
          </div>
          <div className="hidden w-40 shrink-0 truncate text-[10px] text-[var(--text-faint)] lg:block">
            {span.detail}
          </div>
        </div>
      </summary>
      <div className="border-l border-[var(--border-subtle)] pl-1">
        {span.children.map((child) => (
          <div key={child.id}>
            <SpanRow span={child} totalMs={totalMs} indent={1} />
            {/* A model call the proxy also saw carries its row underneath. */}
            {child.children.map((grandchild) => (
              <SpanRow
                key={grandchild.id}
                span={grandchild}
                totalMs={totalMs}
                indent={2}
              />
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

export function SessionTraceWaterfall({
  trace,
  truncated = false,
}: {
  trace: SessionTrace;
  truncated?: boolean;
}) {
  const { root, totalMs, idleGaps } = trace;
  const turnCount = root.children.filter((c) => c.kind === "turn").length;
  const defaultOpen = turnCount <= AUTO_COLLAPSE_ABOVE;

  // Keep only gap labels far enough apart to read. Bands still mark them all.
  const labelledGaps: IdleGap[] = [];
  let lastLabelPct = -Infinity;
  for (const g of idleGaps) {
    const pct = (g.atMs / totalMs) * 100;
    if (pct - lastLabelPct >= MIN_GAP_LABEL_SPACING_PCT) {
      labelledGaps.push(g);
      lastLabelPct = pct;
    }
  }

  return (
    <div className="min-w-[720px]">
      {/* Time axis */}
      <div className="flex items-end gap-3 pb-1">
        <div className="shrink-0" style={{ width: 320 }}>
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
            Span
          </span>
          {idleGaps.length > 0 && (
            <span className="ml-2 text-[9px] normal-case text-[var(--text-faint)]">
              active time — {idleGaps.length} idle gap
              {idleGaps.length === 1 ? "" : "s"} elided
            </span>
          )}
        </div>
        {/*
          Two bands of labels share this row: elided-gap markers pinned to the
          top, elapsed ticks to the bottom. It needs to be tall enough to hold
          both — at h-4 a gap marker lands on top of whichever tick it is
          nearest and neither is readable.
        */}
        <div className="relative h-7 flex-1">
          {Array.from({ length: AXIS_TICKS + 1 }, (_, i) => {
            const pct = (i / AXIS_TICKS) * 100;
            return (
              <span
                key={i}
                className="absolute bottom-0 font-mono text-[9px] text-[var(--text-faint)]"
                style={{
                  left: `${pct}%`,
                  transform:
                    i === 0
                      ? "none"
                      : i === AXIS_TICKS
                        ? "translateX(-100%)"
                        : "translateX(-50%)",
                }}
              >
                {formatMs((totalMs * i) / AXIS_TICKS)}
              </span>
            );
          })}
          {labelledGaps.map((g) => (
            <span
              key={`gap-${g.atMs}`}
              className="absolute top-0 whitespace-nowrap font-mono text-[9px] text-[var(--text-muted)]"
              style={{
                left: `${(g.atMs / totalMs) * 100}%`,
                transform: "translateX(-50%)",
              }}
              title={`${formatElapsed(g.durationMs)} idle (elided)`}
            >
              ⋯{formatElapsed(g.durationMs)}
            </span>
          ))}
        </div>
        <div className="w-24 shrink-0 text-right text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)]">
          Duration
        </div>
        <div className="hidden w-40 shrink-0 text-[10px] font-bold uppercase tracking-wider text-[var(--text-faint)] lg:block">
          Detail
        </div>
      </div>

      {/* Rows, over a single shared gridline/gap backdrop. */}
      <div className="relative">
        <TimelineBackdrop idleGaps={idleGaps} totalMs={totalMs} />

        <div className="border-t border-[var(--border-default)]">
          <SpanRow
            span={{ ...root, name: "session", detail: "", children: [] }}
            totalMs={totalMs}
            indent={0}
          />
        </div>

        {/* Turns and lifecycle events, interleaved in chronological order */}
        {root.children.map((child) =>
          child.kind === "turn" ? (
            <TurnRow
              key={child.id}
              span={child}
              totalMs={totalMs}
              defaultOpen={defaultOpen}
            />
          ) : (
            <div
              key={child.id}
              className="border-t border-[var(--border-subtle)]"
            >
              <SpanRow span={child} totalMs={totalMs} indent={1} />
            </div>
          ),
        )}
      </div>

      {truncated && (
        <p className="border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--text-muted)]">
          Trace truncated to the first {trace.eventCount.toLocaleString("en-US")}{" "}
          events of this session. The full event stream is available in the{" "}
          <span className="text-[var(--text-secondary)]">audit log</span>.
        </p>
      )}
    </div>
  );
}
