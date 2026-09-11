import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  type ClaudeCodeEventRow,
  CLAUDE_CODE_EVENT_SELECT,
  eventDetail,
  formatMs,
} from "@/lib/claude-code-events";

// ─── Session traces (synthesized) ────────────────────────────────────────
// Claude Code's OTel exporter emits metrics + logs/events only — there is no
// traces exporter and therefore no real spans (see ops/otel-collector).
// But the event stream carries everything a trace needs: `sessionId` groups a
// run, `promptId` groups a turn within it, and `durationMs` gives span width.
// So we assemble the trace at query time instead of collecting it.
//
// Three facts about the source data drive the arithmetic below:
//   1. `timestamp` is the event's END (verified against tool_decision →
//      tool_result pairs), so a span starts at `timestamp - durationMs`.
//   2. A small number of rows carry implausible durations (>1h), which would
//      otherwise stretch the whole waterfall — hence MAX_EVENT_SPAN_MS.
//   3. `eventSequence` restarts on session resume, so it cannot order a
//      session — see compareEvents.

// Hard cap on a single event's rendered span. Long-but-real spans (a slow
// Bash step, a big WebFetch) stay under this; the bogus multi-hour rows don't.
export const MAX_EVENT_SPAN_MS = 30 * 60 * 1000;

// Sessions get resumed (`--continue`) across hours or days, so wall-clock is
// the wrong axis: a 21-day session would squash every real span into an
// invisible sliver. We therefore plot *active* time — any dead gap longer
// than IDLE_GAP_MS is elided to IDLE_RENDER_MS of display width and marked on
// the axis. The mapping is piecewise-linear and monotonic, so timing stays
// truthful within each active stretch and parent/child containment holds.
export const IDLE_GAP_MS = 30 * 1000;
export const IDLE_RENDER_MS = 2 * 1000;

// Ceiling on the share of the timeline that elided gaps may occupy, together.
// A month-long session can hold 50+ resume gaps; at a flat IDLE_RENDER_MS each
// they swallowed half the width and squeezed the actual work into specks. Each
// gap gets an equal slice of this budget, capped at IDLE_RENDER_MS, so a
// handful of gaps render at full width and many render thin.
export const IDLE_BUDGET = 0.25;

// Ceiling on how many events one trace renders, to bound the page.
export const MAX_TRACE_EVENTS = 1500;

// The audit-log select omits the two correlation columns a trace needs, so
// extend it rather than maintaining a second, drifting column list.
export const CLAUDE_CODE_TRACE_SELECT = {
  ...CLAUDE_CODE_EVENT_SELECT,
  promptId: true,
  eventSequence: true,
} as const;

export interface TraceEventRow extends ClaudeCodeEventRow {
  promptId: string | null;
  eventSequence: number | null;
}

export type SpanStatus = "ok" | "error" | "denied" | "flagged";

/**
 * The proxy's record of one model call, as seen from `APIUsageLog`.
 *
 * Claude Code reports an `api_request` event for every model call; when that
 * call went through the ai-proxy, the proxy logged the same call separately
 * and stored the provider's request id. Matching the two gives a trace the
 * proxy's independent view — the latency it measured upstream, the cost it
 * computed, and any policy decision it made — which the client's own
 * telemetry cannot show.
 */
export interface ProxyCall {
  id: string;
  requestId: string;
  model: string | null;
  totalTokens: number;
  cost: number;
  flagged: boolean;
  flagCategory: string | null;
  flagReason: string | null;
  /** Upstream latency the proxy measured, from promptMetadata.latencyMs. */
  latencyMs: number | null;
}

export interface TraceSpan {
  id: string;
  /** Display label — an event name, "Turn N", or the session id. */
  name: string;
  kind: "session" | "turn" | "event" | "proxy";
  /** Start/end as ms offsets from the start of the trace. */
  startMs: number;
  endMs: number;
  /** True when the source event carried no duration: rendered as a marker. */
  instant: boolean;
  /** True when durationMs was implausible and got clamped. */
  clamped: boolean;
  /**
   * The duration the event itself reported, independent of the bar geometry.
   * Null when it reported none. Prefer this for the numeric readout: the bar
   * may have been pinned forward to keep the trace in order (`clipped`).
   */
  reportedMs: number | null;
  /** True when this bar's start was pinned forward. */
  clipped: boolean;
  status: SpanStatus;
  /** One-line metadata summary (reuses the audit log's formatter). */
  detail: string;
  eventName: string | null;
  toolName: string | null;
  riskSeverity: string | null;
  riskCategory: string | null;
  timestamp: Date | null;
  children: TraceSpan[];
}

export interface IdleGap {
  /** Where the gap sits on the display timeline, in ms. */
  atMs: number;
  /** How much real time was skipped. */
  durationMs: number;
  /** How much display width the gap was given (see IDLE_BUDGET). */
  renderMs: number;
}

export interface SessionTrace {
  sessionId: string;
  userEmail: string | null;
  entrypoint: string | null;
  startedAt: Date;
  endedAt: Date;
  /**
   * Width of the *display* timeline — active time, with idle gaps elided.
   * This is the denominator for every bar.
   */
  totalMs: number;
  /** Real elapsed time from first to last event, gaps included. */
  wallClockMs: number;
  /** Elided idle gaps: display offset + the real duration skipped. */
  idleGaps: IdleGap[];
  eventCount: number;
  turnCount: number;
  /** Model calls in this trace that the proxy also logged. */
  proxyCallCount: number;
  errorCount: number;
  flaggedCount: number;
  root: TraceSpan;
}

// Events that mean the turn (or session) failed outright.
const ERROR_EVENTS = new Set([
  "api_error",
  "internal_error",
  "api_retries_exhausted",
  "api_refusal",
]);

const STATUS_RANK: Record<SpanStatus, number> = {
  ok: 0,
  denied: 1,
  error: 2,
  flagged: 3,
};

/** Governance-first: a risk verdict outranks an operational failure. */
export function eventStatus(e: TraceEventRow): SpanStatus {
  if (e.riskSeverity) return "flagged";
  if (e.decision === "reject" || e.decision === "deny") return "denied";
  if (ERROR_EVENTS.has(e.eventName)) return "error";
  if (e.success === false) return "error";
  return "ok";
}

function worstStatus(statuses: SpanStatus[]): SpanStatus {
  return statuses.reduce<SpanStatus>(
    (worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst),
    "ok",
  );
}

/**
 * Chronological comparator for a session's events.
 *
 * `eventSequence` looks like the natural ordering key but is NOT safe as the
 * primary one: it restarts on every session resume, so it is a per-*process*
 * counter, not per-session. A 30-day resumed session was observed with 4,925
 * events across just 46 distinct sequence values, and sorting by it threw the
 * trace out of order by up to 719 hours. `timestamp` is authoritative;
 * `eventSequence` only breaks ties inside the same millisecond (an
 * api_request and its assistant_response often share one), where it is
 * reliable because ties can only come from a single process.
 */
function compareEvents(a: TraceEventRow, b: TraceEventRow): number {
  const byTime = a.timestamp.getTime() - b.timestamp.getTime();
  if (byTime !== 0) return byTime;
  return (a.eventSequence ?? 0) - (b.eventSequence ?? 0);
}

/**
 * The provider request id Claude Code recorded for a model call.
 *
 * Present on ~99% of `api_request` events as `request_id` (e.g.
 * "req_011CeZ..."); the proxy stores the same value on APIUsageLog.requestId.
 */
export function requestIdOf(e: TraceEventRow): string | null {
  const attrs = e.attributes as Record<string, unknown> | null;
  const id = attrs?.request_id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** How a proxy verdict maps onto the trace's status vocabulary. */
export function proxyStatus(call: ProxyCall): SpanStatus {
  switch (call.flagCategory) {
    case "prompt_risk":
      return "denied";
    case "sensitive_response":
      return "flagged";
    case "upstream_error":
    case "proxy_error":
      return "error";
    default:
      return call.flagged ? "flagged" : "ok";
  }
}

function proxyDetail(call: ProxyCall): string {
  const parts: string[] = ["via proxy"];
  if (call.latencyMs != null) parts.push(`${formatMs(call.latencyMs)} upstream`);
  if (call.totalTokens > 0) parts.push(`${call.totalTokens.toLocaleString("en-US")} tok`);
  if (call.cost > 0) parts.push(`$${call.cost.toFixed(4)}`);
  if (call.flagReason) parts.push(call.flagReason);
  else if (call.flagCategory) parts.push(call.flagCategory);
  return parts.join(" · ");
}

interface ActiveInterval {
  absStart: number;
  absEnd: number;
  /** Display offset this interval's absStart maps to. */
  dispStart: number;
}

/**
 * Build a monotonic absolute→display time mapping that elides idle gaps.
 *
 * `spans` are the absolute [start, end] pairs of every event. Their merged
 * union is the session's active time; whatever falls between merged intervals
 * is dead air. Because the intervals are the union of all spans, every span
 * lies wholly inside exactly one interval — so the mapping never has to split
 * a span, and containment survives compression.
 *
 * Exported for tests.
 */
export function buildTimeMapping(spans: { start: number; end: number }[]): {
  intervals: ActiveInterval[];
  idleGaps: IdleGap[];
  totalMs: number;
} {
  const sorted = [...spans].sort((a, b) => a.start - b.start);

  // Merge overlapping / near-touching spans into active intervals.
  const merged: { absStart: number; absEnd: number }[] = [];
  for (const s of sorted) {
    const last = merged[merged.length - 1];
    // Merge when the next span starts before the running interval ends, or
    // close enough after it that the gap isn't worth eliding.
    if (last && s.start - last.absEnd <= IDLE_GAP_MS) {
      last.absEnd = Math.max(last.absEnd, s.end);
    } else {
      merged.push({ absStart: s.start, absEnd: s.end });
    }
  }

  // Share the elision budget across however many gaps there are.
  const activeMs = merged.reduce((sum, m) => sum + (m.absEnd - m.absStart), 0);
  const gapCount = Math.max(merged.length - 1, 0);
  const perGapMs =
    gapCount > 0
      ? Math.min(IDLE_RENDER_MS, (activeMs * IDLE_BUDGET) / gapCount)
      : 0;

  const intervals: ActiveInterval[] = [];
  const idleGaps: IdleGap[] = [];
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const m = merged[i];
    intervals.push({ absStart: m.absStart, absEnd: m.absEnd, dispStart: cursor });
    cursor += m.absEnd - m.absStart;
    const next = merged[i + 1];
    if (next) {
      idleGaps.push({
        atMs: cursor,
        durationMs: next.absStart - m.absEnd,
        renderMs: perGapMs,
      });
      cursor += perGapMs;
    }
  }

  return { intervals, idleGaps, totalMs: Math.max(cursor, 1) };
}

/** Map an absolute timestamp onto the compressed display timeline. */
function mapTime(intervals: ActiveInterval[], abs: number): number {
  for (let i = 0; i < intervals.length; i++) {
    const iv = intervals[i];
    if (abs <= iv.absEnd) {
      // Clamp into the interval: a value in a preceding gap pins to its start.
      return iv.dispStart + Math.max(abs - iv.absStart, 0);
    }
  }
  const last = intervals[intervals.length - 1];
  return last ? last.dispStart + (last.absEnd - last.absStart) : 0;
}

/**
 * Assemble a session trace from its raw event rows. Pure — no I/O — so the
 * tree shape and the timing arithmetic are unit-testable.
 *
 * Shape: session root → turns (one per promptId) and lifecycle events (those
 * without a promptId, which belong to no turn) → the events inside each turn.
 */
export function buildSessionTrace(
  sessionId: string,
  events: TraceEventRow[],
  /** Proxy rows for this session's model calls, keyed by provider request id. */
  proxyCalls: ProxyCall[] = [],
): SessionTrace | null {
  if (events.length === 0) return null;

  const proxyByRequestId = new Map(proxyCalls.map((c) => [c.requestId, c]));

  const ordered = [...events].sort(compareEvents);

  // Absolute start/end per event, before we know the trace origin.
  const timed = ordered.map((e) => {
    const rawDuration = e.durationMs ?? 0;
    const duration = Math.min(Math.max(rawDuration, 0), MAX_EVENT_SPAN_MS);
    const end = e.timestamp.getTime();
    return {
      event: e,
      start: end - duration,
      end,
      /** The duration the event reported, before any geometry clipping. */
      reportedMs: e.durationMs == null ? null : duration,
      instant: rawDuration <= 0,
      clamped: rawDuration > MAX_EVENT_SPAN_MS,
      clipped: false,
    };
  });

  // Some events report a duration whose window reaches back before earlier
  // events began — the reported span includes queueing, or a streaming
  // response overlaps the tool calls made during it. Taken literally those
  // spans render out of chronological order, which reads as a broken trace.
  //
  // So pin span *starts* to be non-decreasing. Concurrency is preserved
  // (parallel tool calls are dispatched in order, so their starts already
  // ascend and only their ends overlap), and the reported duration survives
  // untouched on `reportedMs` for the numeric readout — only the bar's
  // geometry is adjusted, and `clipped` records that it was.
  let floor = -Infinity;
  for (const t of timed) {
    if (t.start < floor) {
      t.start = floor;
      t.end = Math.max(t.end, floor);
      t.clipped = true;
    } else {
      floor = t.start;
    }
  }

  const traceStart = Math.min(...timed.map((t) => t.start));
  const traceEnd = Math.max(...timed.map((t) => t.end));

  // Plot active time, not wall-clock — see IDLE_GAP_MS.
  const { intervals, idleGaps, totalMs } = buildTimeMapping(timed);

  const toSpan = (t: (typeof timed)[number]): TraceSpan => {
    const e = t.event;
    return {
      id: e.id,
      name: e.eventName,
      kind: "event",
      startMs: mapTime(intervals, t.start),
      endMs: mapTime(intervals, t.end),
      instant: t.instant,
      clamped: t.clamped,
      reportedMs: t.reportedMs,
      clipped: t.clipped,
      status: eventStatus(e),
      detail: eventDetail(e),
      eventName: e.eventName,
      toolName: e.toolName,
      riskSeverity: e.riskSeverity,
      riskCategory: e.riskCategory,
      timestamp: e.timestamp,
      children: proxyChildren(t),
    };
  };

  /**
   * The proxy's row for this call, as a child span.
   *
   * Both records end at the same moment — the response completing — so the
   * child is right-aligned to its parent and sized by the latency the proxy
   * measured upstream. That makes the gap between the two bars meaningful:
   * it is the client-side overhead (network to the proxy, queueing) that the
   * provider itself never saw. The child is clamped inside the parent so
   * containment holds even if the two clocks disagree.
   */
  function proxyChildren(t: (typeof timed)[number]): TraceSpan[] {
    if (t.event.eventName !== "api_request") return [];
    const requestId = requestIdOf(t.event);
    if (!requestId) return [];
    const call = proxyByRequestId.get(requestId);
    if (!call) return [];

    const start =
      call.latencyMs != null
        ? Math.min(Math.max(t.end - call.latencyMs, t.start), t.end)
        : t.start;

    return [
      {
        id: `proxy:${call.id}`,
        name: "proxy",
        kind: "proxy",
        startMs: mapTime(intervals, start),
        endMs: mapTime(intervals, t.end),
        instant: false,
        clamped: false,
        reportedMs: call.latencyMs,
        clipped: false,
        status: proxyStatus(call),
        detail: proxyDetail(call),
        eventName: null,
        toolName: null,
        riskSeverity: null,
        riskCategory: null,
        timestamp: t.event.timestamp,
        children: [],
      },
    ];
  }

  // Walk in sequence order, opening a turn span whenever the promptId changes.
  // Events without a promptId hang directly off the session root — they are
  // startup/teardown work (MCP connects, hook registration, retention sweeps)
  // that genuinely belongs to no turn.
  const topLevel: TraceSpan[] = [];
  const turnsByPrompt = new Map<string, TraceSpan>();
  let turnNumber = 0;

  for (const t of timed) {
    const span = toSpan(t);
    const promptId = t.event.promptId;

    if (!promptId) {
      topLevel.push(span);
      continue;
    }

    let turn = turnsByPrompt.get(promptId);
    if (!turn) {
      turnNumber += 1;
      turn = {
        id: `turn:${promptId}`,
        name: `Turn ${turnNumber}`,
        kind: "turn",
        startMs: span.startMs,
        endMs: span.endMs,
        instant: false,
        clamped: false,
        reportedMs: null,
        clipped: false,
        status: "ok",
        detail: "",
        eventName: null,
        toolName: null,
        riskSeverity: null,
        riskCategory: null,
        timestamp: t.event.timestamp,
        children: [],
      };
      turnsByPrompt.set(promptId, turn);
      topLevel.push(turn);
    }
    turn.children.push(span);
  }

  // A proxy verdict is a real governance outcome, so let it raise the status
  // of the model call it belongs to rather than hiding one level down.
  for (const turn of turnsByPrompt.values()) {
    for (const child of turn.children) {
      if (child.children.length > 0) {
        child.status = worstStatus([
          child.status,
          ...child.children.map((c) => c.status),
        ]);
      }
    }
  }

  // Roll turn geometry, status, and summary up from their children.
  for (const turn of turnsByPrompt.values()) {
    turn.startMs = Math.min(...turn.children.map((c) => c.startMs));
    turn.endMs = Math.max(...turn.children.map((c) => c.endMs));
    turn.status = worstStatus(turn.children.map((c) => c.status));
    turn.clamped = turn.children.some((c) => c.clamped);
    turn.clipped = turn.children.some((c) => c.clipped);
    turn.detail = turnSummary(turn.children);
  }

  const proxyCallCount = topLevel
    .flatMap((c) => (c.kind === "turn" ? c.children : [c]))
    .filter((c) => c.children.some((g) => g.kind === "proxy")).length;

  // Counted off the spans rather than the raw events, so a verdict that only
  // the proxy saw is reflected in the header instead of contradicting it.
  const leafSpans = topLevel.flatMap((c) =>
    c.kind === "turn" ? c.children : [c],
  );
  const errorCount = leafSpans.filter(
    (c) => c.status === "error" || c.status === "denied",
  ).length;
  const flaggedCount = leafSpans.filter((c) => c.status === "flagged").length;

  const root: TraceSpan = {
    id: `session:${sessionId}`,
    name: sessionId,
    kind: "session",
    startMs: 0,
    endMs: totalMs,
    instant: false,
    clamped: timed.some((t) => t.clamped),
    reportedMs: null,
    clipped: timed.some((t) => t.clipped),
    status: worstStatus(topLevel.map((s) => s.status)),
    detail: "",
    eventName: null,
    toolName: null,
    riskSeverity: null,
    riskCategory: null,
    timestamp: new Date(traceStart),
    children: topLevel,
  };

  // userEmail / entrypoint are per-session in practice but nullable per row;
  // take the first non-null rather than assuming row 0 carries them.
  const userEmail = ordered.find((e) => e.userEmail)?.userEmail ?? null;
  const entrypoint = ordered.find((e) => e.entrypoint)?.entrypoint ?? null;

  return {
    sessionId,
    userEmail,
    entrypoint,
    startedAt: new Date(traceStart),
    endedAt: new Date(traceEnd),
    totalMs,
    wallClockMs: Math.max(traceEnd - traceStart, 0),
    idleGaps,
    eventCount: ordered.length,
    proxyCallCount,
    turnCount: turnsByPrompt.size,
    errorCount,
    flaggedCount,
    root,
  };
}

/** "4 tools · 6 model calls · 1 error" — the collapsed-turn one-liner. */
export function turnSummary(children: TraceSpan[]): string {
  const tools = children.filter((c) => c.eventName === "tool_result").length;
  const calls = children.filter((c) => c.eventName === "api_request").length;
  const errors = children.filter(
    (c) => c.status === "error" || c.status === "denied",
  ).length;
  const flagged = children.filter((c) => c.status === "flagged").length;
  const parts: string[] = [];
  if (calls) parts.push(`${calls} model call${calls === 1 ? "" : "s"}`);
  if (tools) parts.push(`${tools} tool${tools === 1 ? "" : "s"}`);
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (flagged) parts.push(`${flagged} flagged`);
  return parts.join(" · ");
}

// ─── Loaders ─────────────────────────────────────────────────────────────
// Every loader is awaited sequentially by its caller: the local .env points
// at the prod Azure DB with connection_limit=1, so parallel queries flake.

/** Audit retention window the session index searches over. */
export const SESSION_WINDOW_DAYS = 30;
export const SESSIONS_PAGE_SIZE = 25;

export function sessionWindowStart(): Date {
  return new Date(Date.now() - SESSION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export interface SessionSummary {
  sessionId: string;
  userEmail: string | null;
  entrypoint: string | null;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  events: number;
  turns: number;
  tools: number;
  errors: number;
  flagged: number;
}

export interface SessionListFilters {
  /** Free-text over session id and user email. */
  q?: string | null;
  userEmail?: string | null;
  /** app.entrypoint, e.g. "local-agent" for Cowork. */
  surface?: string | null;
  /** "flagged" | "critical" | "warning" — restrict to sessions with risk. */
  risk?: string | null;
  /** Only sessions containing an error or a denied tool call. */
  errorsOnly?: boolean;
}

function sessionFilterClause(f: SessionListFilters) {
  const parts: Prisma.Sql[] = [];
  if (f.userEmail) parts.push(Prisma.sql`AND "userEmail" = ${f.userEmail}`);
  if (f.surface) parts.push(Prisma.sql`AND "entrypoint" = ${f.surface}`);
  if (f.q) {
    const like = `%${f.q}%`;
    parts.push(
      Prisma.sql`AND ("sessionId" ILIKE ${like} OR "userEmail" ILIKE ${like})`,
    );
  }
  return parts.length ? Prisma.join(parts, " ") : Prisma.empty;
}

// Risk and error filters are properties of the *session*, not of a row, so
// they apply to the grouped aggregate rather than the row-level WHERE.
function sessionHavingClause(f: SessionListFilters) {
  const parts: Prisma.Sql[] = [];
  if (f.risk === "flagged") {
    parts.push(Prisma.sql`COUNT(*) FILTER (WHERE "riskSeverity" IS NOT NULL) > 0`);
  } else if (f.risk === "critical" || f.risk === "warning") {
    parts.push(
      Prisma.sql`COUNT(*) FILTER (WHERE "riskSeverity" = ${f.risk}) > 0`,
    );
  }
  if (f.errorsOnly) {
    parts.push(
      Prisma.sql`COUNT(*) FILTER (WHERE "eventName" IN ('api_error', 'internal_error', 'api_retries_exhausted', 'api_refusal') OR "success" = false OR "decision" IN ('reject', 'deny')) > 0`,
    );
  }
  return parts.length
    ? Prisma.sql`HAVING ${Prisma.join(parts, " AND ")}`
    : Prisma.empty;
}

interface SessionRow {
  sessionId: string;
  user_email: string | null;
  entrypoint: string | null;
  started: Date;
  ended: Date;
  events: number;
  turns: number;
  tools: number;
  errors: number;
  flagged: number;
}

export async function loadSessionList(
  filters: SessionListFilters,
  page: number,
): Promise<SessionSummary[]> {
  const rows = await prisma.$queryRaw<SessionRow[]>`
    SELECT
      "sessionId",
      MAX("userEmail") AS user_email,
      MAX("entrypoint") AS entrypoint,
      MIN("timestamp") AS started,
      MAX("timestamp") AS ended,
      COUNT(*)::int AS events,
      COUNT(DISTINCT "promptId")::int AS turns,
      COUNT(*) FILTER (WHERE "eventName" = 'tool_result')::int AS tools,
      COUNT(*) FILTER (
        WHERE "eventName" IN ('api_error', 'internal_error', 'api_retries_exhausted', 'api_refusal')
           OR "success" = false
           OR "decision" IN ('reject', 'deny')
      )::int AS errors,
      COUNT(*) FILTER (WHERE "riskSeverity" IS NOT NULL)::int AS flagged
    FROM "ClaudeCodeEvent"
    WHERE "timestamp" >= ${sessionWindowStart()}
      AND "sessionId" IS NOT NULL
      ${sessionFilterClause(filters)}
    GROUP BY "sessionId"
    ${sessionHavingClause(filters)}
    ORDER BY MAX("timestamp") DESC
    LIMIT ${SESSIONS_PAGE_SIZE}
    OFFSET ${(page - 1) * SESSIONS_PAGE_SIZE}`;

  return rows.map((r) => ({
    sessionId: r.sessionId,
    userEmail: r.user_email,
    entrypoint: r.entrypoint,
    startedAt: r.started,
    endedAt: r.ended,
    durationMs: r.ended.getTime() - r.started.getTime(),
    events: r.events,
    turns: r.turns,
    tools: r.tools,
    errors: r.errors,
    flagged: r.flagged,
  }));
}

export async function countSessions(
  filters: SessionListFilters,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n FROM (
      SELECT "sessionId"
      FROM "ClaudeCodeEvent"
      WHERE "timestamp" >= ${sessionWindowStart()}
        AND "sessionId" IS NOT NULL
        ${sessionFilterClause(filters)}
      GROUP BY "sessionId"
      ${sessionHavingClause(filters)}
    ) s`;
  return Number(rows[0]?.n ?? 0);
}

export interface LoadedTrace {
  trace: SessionTrace | null;
  /** True when the session had more events than MAX_TRACE_EVENTS. */
  truncated: boolean;
}

/** Fetch one session's events and assemble its trace. */
export async function loadSessionTrace(
  sessionId: string,
): Promise<LoadedTrace> {
  const events = (await prisma.claudeCodeEvent.findMany({
    where: { sessionId },
    // Chronological, for the same reason as compareEvents — and because the
    // `take` below must window the *earliest* events, not an arbitrary slice.
    orderBy: [{ timestamp: "asc" }, { eventSequence: "asc" }],
    take: MAX_TRACE_EVENTS + 1,
    select: CLAUDE_CODE_TRACE_SELECT,
  })) as TraceEventRow[];

  const truncated = events.length > MAX_TRACE_EVENTS;
  const windowed = truncated ? events.slice(0, MAX_TRACE_EVENTS) : events;

  const trace = buildSessionTrace(
    sessionId,
    windowed,
    await loadProxyCalls(windowed),
  );
  return { trace, truncated };
}

/**
 * Fetch the proxy's rows for this session's model calls.
 *
 * Only calls routed through the ai-proxy have a row, which today is a small
 * fraction of traffic — so this skips the query entirely when the session
 * reports no request ids, and is a single indexed `IN` lookup otherwise.
 */
async function loadProxyCalls(events: TraceEventRow[]): Promise<ProxyCall[]> {
  const requestIds = [
    ...new Set(
      events
        .filter((e) => e.eventName === "api_request")
        .map(requestIdOf)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (requestIds.length === 0) return [];

  const rows = await prisma.aPIUsageLog.findMany({
    where: { requestId: { in: requestIds } },
    select: {
      id: true,
      requestId: true,
      model: true,
      totalTokens: true,
      cost: true,
      flagged: true,
      flagCategory: true,
      flagReason: true,
      promptMetadata: true,
    },
  });

  return rows.flatMap((r) => {
    if (!r.requestId) return [];
    const meta = r.promptMetadata as Record<string, unknown> | null;
    const latency = meta?.latencyMs;
    return [
      {
        id: r.id,
        requestId: r.requestId,
        model: r.model,
        totalTokens: r.totalTokens,
        cost: r.cost,
        flagged: r.flagged,
        flagCategory: r.flagCategory,
        flagReason: r.flagReason,
        latencyMs: typeof latency === "number" ? latency : null,
      },
    ];
  });
}

/** Distinct app.entrypoint values, for the surface filter. */
export async function loadSessionSurfaces(): Promise<string[]> {
  const groups = await prisma.claudeCodeEvent.groupBy({
    by: ["entrypoint"],
    where: {
      timestamp: { gte: sessionWindowStart() },
      entrypoint: { not: null },
    },
    orderBy: { entrypoint: "asc" },
  });
  return groups
    .map((g) => g.entrypoint)
    .filter((e): e is string => Boolean(e));
}

/**
 * Coarse elapsed-time label. `formatMs` is built for span-scale numbers and
 * degrades badly past a few minutes ("1810886.0s"); session wall-clock and
 * idle gaps run to hours and days, so they need this instead.
 */
export function formatElapsed(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const secs = ms / 1000;
  if (secs < 90) return `${secs.toFixed(1)}s`;

  // Derive every coarser unit from whole minutes so the rounding carries.
  // Rounding each unit independently produces "2d 24h" for a hair under
  // three days, and "1h 60m" for a hair under two hours.
  const totalMins = Math.round(secs / 60);
  if (totalMins < 60) return `${totalMins}m`;

  const totalHours = Math.floor(totalMins / 60);
  const remMins = totalMins % 60;
  if (totalHours < 24) {
    return remMins > 0 ? `${totalHours}h ${remMins}m` : `${totalHours}h`;
  }

  const days = Math.floor(totalHours / 24);
  const remHours = totalHours % 24;
  return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`;
}
