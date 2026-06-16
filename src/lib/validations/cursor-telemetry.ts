import { z } from "zod";
import {
  keyValueSchema,
  attributesToMap,
  nanoToDate,
  nanoDiffMs,
  readDataPointValue,
  str,
  bool,
} from "./otlp-shared";

// ─── Cursor telemetry (OTLP traces + derived metrics) ────
//
// Cursor reports via `LangGuard-AI/cursor-otel-hook`, which emits OTLP
// *spans* (traces) — it does NOT emit OTLP metrics or logs the way Claude
// Code does. Span attributes follow the GenAI + LangSmith conventions:
//   gen_ai.system, gen_ai.request.model, gen_ai.operation.name,
//   gen_ai.tool.name, langsmith.span.kind (llm|tool|chain),
//   langsmith.trace.session_id, langsmith.metadata.hook_event,
//   langsmith.metadata.cursor_version
//
// Two pipelines land Cursor data in UrNammu, both fed from the same span
// stream at the collector:
//   1. raw spans  → flattenOtlpSpans()    → CursorSpan   (audit trail)
//   2. spanmetrics connector → cursor.*    → flattenCursorMetrics() → CursorMetric
//
// Cursor's hook carries NO token counts or cost, so CursorMetric is
// activity-only (tool-use / session / exec counts + span durations).

// ─── OTLP/JSON span shape (subset we consume) ────────────

const spanStatusSchema = z.object({
  // STATUS_CODE_UNSET=0, OK=1, ERROR=2 (numeric) — some exporters send the
  // string enum, so accept both.
  code: z.union([z.number(), z.string()]).optional(),
  message: z.string().optional(),
});

const spanSchema = z.object({
  traceId: z.string().optional(),
  spanId: z.string().optional(),
  parentSpanId: z.string().optional(),
  name: z.string().optional(),
  // Numeric OTLP SpanKind; the semantic kind lives in langsmith.span.kind.
  kind: z.union([z.number(), z.string()]).optional(),
  startTimeUnixNano: z.union([z.string(), z.number()]).optional(),
  endTimeUnixNano: z.union([z.string(), z.number()]).optional(),
  attributes: z.array(keyValueSchema).optional(),
  status: spanStatusSchema.optional(),
});

const scopeSpansSchema = z.object({
  spans: z.array(spanSchema).optional(),
});

const resourceSpansSchema = z.object({
  resource: z
    .object({ attributes: z.array(keyValueSchema).optional() })
    .optional(),
  scopeSpans: z.array(scopeSpansSchema).optional(),
});

export const otlpTracesPayloadSchema = z.object({
  resourceSpans: z.array(resourceSpansSchema).optional(),
});

export type OtlpTracesPayload = z.infer<typeof otlpTracesPayloadSchema>;

// Span attribute keys that can carry source code, prompt text, tool inputs,
// or secrets. Stripped at the collector gateway AND defensively here, so a
// payload posted straight to the route can never persist content. Mirrors
// SENSITIVE_EVENT_KEYS on the Claude Code side.
export const SENSITIVE_SPAN_KEYS = [
  "gen_ai.tool.arguments",
  "gen_ai.prompt",
  "gen_ai.completion",
  "gen_ai.content",
  "tool_arguments",
  "prompt",
  "completion",
  "input",
  "output",
  "body",
] as const;

// Candidate keys that may carry user prompt text on a beforeSubmitPrompt
// span. Read transiently for in-memory risk analysis, then dropped — never
// stored. Deliberately excludes `input` (tool spans put code there, not
// prompts). Kept in priority order. The collector gateway leaves these keys
// on the wire (so risk analysis can run); everything else content-bearing is
// stripped at the gateway. Mirrors Claude Code's `prompt` handling.
const PROMPT_TEXT_KEYS = ["gen_ai.prompt", "prompt"] as const;

// hook_event values that represent a user submitting a prompt to Cursor.
const PROMPT_SUBMIT_EVENTS = new Set(["beforeSubmitPrompt", "submitPrompt"]);

export interface FlattenedSpan {
  timestamp: Date;
  traceId: string | null;
  spanId: string | null;
  parentSpanId: string | null;
  spanName: string;
  // Semantic kind from langsmith.span.kind: llm | tool | chain
  spanKind: string | null;
  // langsmith.metadata.hook_event: sessionStart, preToolUse, postToolUse,
  // beforeShellExecution, beforeMCPExecution, afterFileEdit, beforeSubmitPrompt…
  hookEvent: string | null;
  sessionId: string | null;
  serviceName: string | null;
  genAiSystem: string | null;
  genAiModel: string | null;
  genAiOperation: string | null;
  genAiToolName: string | null;
  durationMs: number | null;
  success: boolean | null;
  // Identity — only present if tagged via OTEL_RESOURCE_ATTRIBUTES on the
  // client (Cursor's hook has no built-in user identity).
  userId: string | null;
  userEmail: string | null;
  appVersion: string | null;
  // Dangerous-prompt verdict — set by the ingest route after in-memory
  // analysis (Option A). Persisted on the row.
  riskSeverity: string | null;
  riskCategory: string | null;
  // Transient prompt text for beforeSubmitPrompt spans, surfaced for
  // in-memory risk analysis ONLY. Never written to the DB and kept out of
  // `attributes` (which is stored).
  promptText: string | null;
  attributes: Record<string, unknown>;
}

function spanSuccess(code: number | string | undefined): boolean | null {
  if (code == null) return null;
  const n = typeof code === "string" ? Number(code) : code;
  // String enum fallback for non-numeric codes.
  if (typeof code === "string" && !Number.isFinite(n)) {
    if (code.includes("ERROR")) return false;
    if (code.includes("OK")) return true;
    return null;
  }
  if (n === 2) return false; // ERROR
  if (n === 1) return true; // OK
  return null; // UNSET — indeterminate
}

/**
 * Flatten an OTLP traces payload into one record per span. Sensitive content
 * keys are deleted from the stored attribute bag; beforeSubmitPrompt prompt
 * text is surfaced transiently on `promptText` for risk analysis only.
 */
export function flattenOtlpSpans(
  payload: OtlpTracesPayload,
  now: Date = new Date(),
): FlattenedSpan[] {
  const rows: FlattenedSpan[] = [];
  for (const rs of payload.resourceSpans ?? []) {
    const resourceAttrs = attributesToMap(rs.resource?.attributes);
    for (const ss of rs.scopeSpans ?? []) {
      for (const sp of ss.spans ?? []) {
        const spanAttrs = attributesToMap(sp.attributes);
        const merged: Record<string, unknown> = {
          ...resourceAttrs,
          ...spanAttrs,
        };
        const hookEvent = str(merged["langsmith.metadata.hook_event"]);
        // Capture prompt text BEFORE stripping — only for submit-prompt spans.
        let promptText: string | null = null;
        if (hookEvent && PROMPT_SUBMIT_EVENTS.has(hookEvent)) {
          for (const k of PROMPT_TEXT_KEYS) {
            const v = str(merged[k]);
            if (v) {
              promptText = v;
              break;
            }
          }
        }
        for (const k of SENSITIVE_SPAN_KEYS) delete merged[k];
        rows.push({
          timestamp: nanoToDate(sp.startTimeUnixNano, now),
          traceId: str(sp.traceId) ?? str(merged["langsmith.trace.id"]),
          spanId: str(sp.spanId) ?? str(merged["langsmith.span.id"]),
          parentSpanId:
            str(sp.parentSpanId) ?? str(merged["langsmith.span.parent_id"]),
          spanName: sp.name ?? "unknown",
          spanKind: str(merged["langsmith.span.kind"]),
          hookEvent,
          sessionId: str(merged["langsmith.trace.session_id"]),
          serviceName: str(merged["service.name"]),
          genAiSystem: str(merged["gen_ai.system"]),
          genAiModel: str(merged["gen_ai.request.model"]),
          genAiOperation: str(merged["gen_ai.operation.name"]),
          genAiToolName: str(merged["gen_ai.tool.name"]),
          durationMs: nanoDiffMs(sp.startTimeUnixNano, sp.endTimeUnixNano),
          success: spanSuccess(sp.status?.code),
          userId: str(merged["user.id"]),
          userEmail: str(merged["user.email"]),
          appVersion: str(merged["langsmith.metadata.cursor_version"]),
          riskSeverity: null,
          riskCategory: null,
          promptText,
          attributes: merged,
        });
      }
    }
  }
  return rows;
}

// ─── Derived metrics (spanmetrics connector → cursor.*) ──
// The collector's spanmetrics connector (namespace: cursor) turns the span
// stream into `cursor.calls` (Sum) and `cursor.duration` (Histogram). We reuse
// the metrics OTLP shape but accept the cursor.* prefix and lift Cursor
// dimensions instead of Claude Code's token/model attributes.

const numberDataPointSchema = z.object({
  attributes: z.array(keyValueSchema).optional(),
  timeUnixNano: z.union([z.string(), z.number()]).optional(),
  asDouble: z.number().optional(),
  asInt: z.union([z.string(), z.number()]).optional(),
});

const histogramDataPointSchema = z.object({
  attributes: z.array(keyValueSchema).optional(),
  timeUnixNano: z.union([z.string(), z.number()]).optional(),
  count: z.union([z.string(), z.number()]).optional(),
  sum: z.number().optional(),
});

const cursorMetricSchema = z.object({
  name: z.string(),
  unit: z.string().optional(),
  sum: z.object({ dataPoints: z.array(numberDataPointSchema).optional() }).optional(),
  gauge: z.object({ dataPoints: z.array(numberDataPointSchema).optional() }).optional(),
  histogram: z
    .object({ dataPoints: z.array(histogramDataPointSchema).optional() })
    .optional(),
});

const cursorScopeMetricsSchema = z.object({
  metrics: z.array(cursorMetricSchema).optional(),
});

const cursorResourceMetricsSchema = z.object({
  resource: z
    .object({ attributes: z.array(keyValueSchema).optional() })
    .optional(),
  scopeMetrics: z.array(cursorScopeMetricsSchema).optional(),
});

export const otlpCursorMetricsPayloadSchema = z.object({
  resourceMetrics: z.array(cursorResourceMetricsSchema).optional(),
});

export type OtlpCursorMetricsPayload = z.infer<
  typeof otlpCursorMetricsPayloadSchema
>;

export interface FlattenedCursorMetric {
  timestamp: Date;
  serviceName: string | null;
  sessionId: string | null;
  userId: string | null;
  userEmail: string | null;
  appVersion: string | null;
  metricName: string;
  value: number;
  unit: string | null;
  spanName: string | null;
  spanKind: string | null;
  genAiToolName: string | null;
  hookEvent: string | null;
  attributes: Record<string, unknown>;
}

/**
 * Flatten the derived `cursor.*` metrics into one record per data point.
 * Drops anything not prefixed `cursor.` (belt-and-braces; the collector's
 * spanmetrics namespace is the first line of defense). Histogram points
 * contribute their `count` (number of spans in the bucket window).
 */
export function flattenCursorMetrics(
  payload: OtlpCursorMetricsPayload,
  now: Date = new Date(),
): FlattenedCursorMetric[] {
  const rows: FlattenedCursorMetric[] = [];
  for (const rm of payload.resourceMetrics ?? []) {
    const resourceAttrs = attributesToMap(rm.resource?.attributes);
    for (const sm of rm.scopeMetrics ?? []) {
      for (const m of sm.metrics ?? []) {
        if (!m.name.startsWith("cursor.")) continue;
        const numberPoints = [
          ...(m.sum?.dataPoints ?? []),
          ...(m.gauge?.dataPoints ?? []),
        ];
        const pushRow = (
          dp: {
            attributes?: Array<z.infer<typeof keyValueSchema>>;
            timeUnixNano?: string | number;
          },
          value: number,
        ) => {
          const merged: Record<string, unknown> = {
            ...resourceAttrs,
            ...attributesToMap(dp.attributes),
          };
          rows.push({
            timestamp: nanoToDate(dp.timeUnixNano, now),
            serviceName: str(merged["service.name"]),
            sessionId: str(merged["langsmith.trace.session_id"]),
            userId: str(merged["user.id"]),
            userEmail: str(merged["user.email"]),
            appVersion: str(merged["langsmith.metadata.cursor_version"]),
            metricName: m.name,
            value,
            unit: m.unit ?? null,
            // spanmetrics emits the span name under `span.name`.
            spanName: str(merged["span.name"] ?? merged["operation"]),
            spanKind: str(merged["langsmith.span.kind"] ?? merged["span.kind"]),
            genAiToolName: str(merged["gen_ai.tool.name"]),
            hookEvent: str(merged["langsmith.metadata.hook_event"]),
            attributes: merged,
          });
        };
        for (const dp of numberPoints) pushRow(dp, readDataPointValue(dp));
        for (const dp of m.histogram?.dataPoints ?? []) {
          const count =
            typeof dp.count === "string" ? Number(dp.count) : dp.count ?? 0;
          pushRow(dp, Number.isFinite(count) ? count : 0);
        }
      }
    }
  }
  return rows;
}

// Surface bool for route-level convenience (parity with claude-code lib).
export { bool };
