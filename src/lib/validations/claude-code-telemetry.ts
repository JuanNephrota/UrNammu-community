import { z } from "zod";
import {
  anyValueSchema,
  keyValueSchema,
  attributesToMap,
  nanoToDate,
  readDataPointValue,
  str,
  num,
  bool,
  type AnyValue,
} from "./otlp-shared";
import { metricDedupeKey, eventDedupeKey } from "./otel-dedupe";

// Re-exported so existing importers of these primitives keep working.
export {
  readAnyValue,
  attributesToMap,
  nanoToDate,
  readDataPointValue,
} from "./otlp-shared";
export type { AnyValue };

// ─── OTLP/JSON metric shape (subset we actually consume) ──
// The spec lives at https://opentelemetry.io/docs/specs/otlp/ — we only
// validate the pieces we read, and stash the rest in `attributes` JSON.
// OTLP primitives (anyValueSchema, keyValueSchema, readers, coercers) live in
// ./otlp-shared and are reused by the Cursor telemetry lib.

const numberDataPointSchema = z.object({
  attributes: z.array(keyValueSchema).optional(),
  timeUnixNano: z.union([z.string(), z.number()]).optional(),
  startTimeUnixNano: z.union([z.string(), z.number()]).optional(),
  asDouble: z.number().optional(),
  asInt: z.union([z.string(), z.number()]).optional(),
});

const histogramDataPointSchema = z.object({
  attributes: z.array(keyValueSchema).optional(),
  timeUnixNano: z.union([z.string(), z.number()]).optional(),
  startTimeUnixNano: z.union([z.string(), z.number()]).optional(),
  count: z.union([z.string(), z.number()]).optional(),
  sum: z.number().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  bucketCounts: z.array(z.union([z.string(), z.number()])).optional(),
  explicitBounds: z.array(z.number()).optional(),
});

type HistogramDataPoint = z.infer<typeof histogramDataPointSchema>;

/**
 * Collapse an OTLP histogram data point to the scalar we store in
 * ClaudeCodeMetric.value. The sum is what every dashboard rolls up
 * (SUM(value) over cost/token metrics), so it wins; a histogram that omits
 * `sum` falls back to its observation count. The count and min/max ride along
 * in `attributes` (histogram.count / .sum / .min / .max) so nothing is lost.
 */
export function readHistogramDataPoint(dp: HistogramDataPoint): {
  value: number;
  extra: Record<string, unknown>;
} {
  const count =
    dp.count == null ? null : typeof dp.count === "string" ? Number(dp.count) : dp.count;
  const sum = typeof dp.sum === "number" ? dp.sum : null;
  const value = sum ?? (count != null && Number.isFinite(count) ? count : 0);
  const extra: Record<string, unknown> = { "otel.aggregation": "histogram" };
  if (count != null && Number.isFinite(count)) extra["histogram.count"] = count;
  if (sum != null) extra["histogram.sum"] = sum;
  if (typeof dp.min === "number") extra["histogram.min"] = dp.min;
  if (typeof dp.max === "number") extra["histogram.max"] = dp.max;
  return { value, extra };
}

const metricSchema = z.object({
  name: z.string(),
  unit: z.string().optional(),
  sum: z
    .object({
      dataPoints: z.array(numberDataPointSchema).optional(),
    })
    .optional(),
  gauge: z
    .object({
      dataPoints: z.array(numberDataPointSchema).optional(),
    })
    .optional(),
  histogram: z
    .object({
      dataPoints: z.array(histogramDataPointSchema).optional(),
    })
    .optional(),
});

const scopeMetricsSchema = z.object({
  metrics: z.array(metricSchema).optional(),
});

const resourceMetricsSchema = z.object({
  resource: z
    .object({
      attributes: z.array(keyValueSchema).optional(),
    })
    .optional(),
  scopeMetrics: z.array(scopeMetricsSchema).optional(),
});

export const otlpMetricsPayloadSchema = z.object({
  resourceMetrics: z.array(resourceMetricsSchema).optional(),
});

export type OtlpMetricsPayload = z.infer<typeof otlpMetricsPayloadSchema>;

// ─── Flattening ──────────────────────────────────────────

export interface FlattenedMetric {
  // Content hash identifying this OTel data point — see ./otel-dedupe.ts.
  // Routes pass it to createMany({ skipDuplicates }) so collector retries
  // of a partially-written batch don't double-count.
  dedupeKey: string;
  timestamp: Date;
  userId: string | null;
  userEmail: string | null;
  sessionId: string | null;
  organizationId: string | null;
  accountUuid: string | null;
  appVersion: string | null;
  hostType: string | null;
  osType: string | null;
  osVersion: string | null;
  terminalType: string | null;
  metricName: string;
  value: number;
  unit: string | null;
  model: string | null;
  tokenType: string | null;
  tool: string | null;
  decision: string | null;
  linesType: string | null;
  attributes: Record<string, unknown>;
}

/**
 * Flatten an OTLP metrics payload into one record per data point. Drops
 * metrics whose name doesn't start with "claude_code." as a belt-and-braces
 * check (the Collector filter pipeline is the first line of defense).
 */
export function flattenOtlpMetrics(
  payload: OtlpMetricsPayload,
  now: Date = new Date(),
): FlattenedMetric[] {
  const rows: FlattenedMetric[] = [];
  for (const rm of payload.resourceMetrics ?? []) {
    const resourceAttrs = attributesToMap(rm.resource?.attributes);
    for (const sm of rm.scopeMetrics ?? []) {
      for (const m of sm.metrics ?? []) {
        if (!m.name.startsWith("claude_code.")) continue;
        // Sum and gauge points carry a scalar; histogram points are
        // collapsed to their sum (see readHistogramDataPoint) so a metric the
        // Collector re-aggregated as a histogram still lands as rows instead
        // of being dropped.
        const dataPoints: {
          attributes?: z.infer<typeof keyValueSchema>[];
          timeUnixNano?: string | number;
          value: number;
          extra: Record<string, unknown>;
        }[] = [
          ...[...(m.sum?.dataPoints ?? []), ...(m.gauge?.dataPoints ?? [])].map((dp) => ({
            attributes: dp.attributes,
            timeUnixNano: dp.timeUnixNano,
            value: readDataPointValue(dp),
            extra: {},
          })),
          ...(m.histogram?.dataPoints ?? []).map((dp) => ({
            attributes: dp.attributes,
            timeUnixNano: dp.timeUnixNano,
            ...readHistogramDataPoint(dp),
          })),
        ];
        for (const dp of dataPoints) {
          const pointAttrs = attributesToMap(dp.attributes);
          const merged: Record<string, unknown> = {
            ...resourceAttrs,
            ...pointAttrs,
            ...dp.extra,
          };
          const timestamp = nanoToDate(dp.timeUnixNano, now);
          const value = dp.value;
          const unit = m.unit ?? null;
          rows.push({
            dedupeKey: metricDedupeKey({
              timeUnixNano: dp.timeUnixNano,
              timestamp,
              metricName: m.name,
              value,
              unit,
              attributes: merged,
            }),
            timestamp,
            userId: str(merged["user.id"]),
            userEmail: str(merged["user.email"]),
            sessionId: str(merged["session.id"]),
            organizationId: str(merged["organization.id"]),
            accountUuid: str(merged["user.account_uuid"]),
            appVersion: str(merged["app.version"]),
            hostType: str(merged["host.type"]),
            osType: str(merged["os.type"]),
            osVersion: str(merged["os.version"]),
            terminalType: str(merged["terminal.type"]),
            metricName: m.name,
            value,
            unit,
            model: str(merged["model"]),
            tokenType: str(merged["type"]),
            tool: str(merged["tool_name"] ?? merged["tool"]),
            decision: str(merged["decision"]),
            linesType: str(merged["type"] /* for lines_of_code.count */),
            attributes: merged,
          });
        }
      }
    }
  }
  return rows;
}

// ─── OTLP/JSON logs (events) shape ───────────────────────
// Claude Code emits events (user_prompt, tool_result, tool_decision,
// api_request, api_error, mcp_server_connection, …) via the OTLP logs/events
// protocol. We validate only the pieces we read and stash the rest in
// `attributes`. Content fields (prompt, tool_input, …) are stripped at the
// collector gateway AND defensively here — see SENSITIVE_EVENT_KEYS.

const logRecordSchema = z.object({
  timeUnixNano: z.union([z.string(), z.number()]).optional(),
  observedTimeUnixNano: z.union([z.string(), z.number()]).optional(),
  severityText: z.string().optional(),
  // OTLP 1.x carries the event name as a top-level field on the record in
  // addition to the `event.name` attribute; accept either.
  eventName: z.string().optional(),
  body: anyValueSchema.optional(),
  attributes: z.array(keyValueSchema).optional(),
});

const scopeLogsSchema = z.object({
  logRecords: z.array(logRecordSchema).optional(),
});

const resourceLogsSchema = z.object({
  resource: z
    .object({ attributes: z.array(keyValueSchema).optional() })
    .optional(),
  scopeLogs: z.array(scopeLogsSchema).optional(),
});

export const otlpLogsPayloadSchema = z.object({
  resourceLogs: z.array(resourceLogsSchema).optional(),
});

export type OtlpLogsPayload = z.infer<typeof otlpLogsPayloadSchema>;

// Attribute keys that can carry source code, prompts, or secrets. The
// collector strips these at the gateway; we strip again here so a payload
// posted directly to the route (bypassing the collector) can never persist
// content. This preserves the original "no prompt content leaves" guarantee.
export const SENSITIVE_EVENT_KEYS = [
  "prompt",
  "tool_input",
  "tool_parameters",
  "error",
  "body",
] as const;

export interface FlattenedEvent {
  // Content hash identifying this log record — computed AFTER sensitive keys
  // are stripped, so a retry that arrives with/without `prompt` dedupes.
  dedupeKey: string;
  timestamp: Date;
  sessionId: string | null;
  promptId: string | null;
  eventSequence: number | null;
  userId: string | null;
  userEmail: string | null;
  organizationId: string | null;
  accountUuid: string | null;
  appVersion: string | null;
  terminalType: string | null;
  eventName: string;
  toolName: string | null;
  decision: string | null;
  decisionSource: string | null;
  success: boolean | null;
  durationMs: number | null;
  model: string | null;
  statusCode: number | null;
  errorType: string | null;
  // app.entrypoint — launch surface (cli / claude-vscode / sdk-* / Cowork's
  // "local-agent"). Requires OTEL_METRICS_INCLUDE_ENTRYPOINT on the client.
  entrypoint: string | null;
  // Dangerous-prompt verdict — set by the ingest route after in-memory
  // analysis (Option A). Persisted on the row.
  riskSeverity: string | null;
  riskCategory: string | null;
  // Transient prompt text for user_prompt events, surfaced for in-memory
  // risk analysis ONLY. Never written to the database — the route reads it,
  // analyzes it, and drops it. Stays out of `attributes` (which is stored).
  promptText: string | null;
  attributes: Record<string, unknown>;
}

/**
 * Flatten an OTLP logs payload into one record per log record. Keeps only
 * records that carry an `event.name` (Claude Code events); anything else is
 * dropped. Sensitive content keys are deleted from the attribute bag.
 */
export function flattenOtlpLogs(
  payload: OtlpLogsPayload,
  now: Date = new Date(),
): FlattenedEvent[] {
  const rows: FlattenedEvent[] = [];
  for (const rl of payload.resourceLogs ?? []) {
    const resourceAttrs = attributesToMap(rl.resource?.attributes);
    for (const sl of rl.scopeLogs ?? []) {
      for (const lr of sl.logRecords ?? []) {
        const recordAttrs = attributesToMap(lr.attributes);
        const merged: Record<string, unknown> = {
          ...resourceAttrs,
          ...recordAttrs,
        };
        const eventName = str(merged["event.name"]) ?? str(lr.eventName);
        if (!eventName) continue;
        // Capture the prompt for in-memory risk analysis BEFORE stripping.
        // Only for user_prompt events; never copied into `attributes`.
        const promptText =
          eventName === "user_prompt" ? str(merged["prompt"]) : null;
        for (const k of SENSITIVE_EVENT_KEYS) delete merged[k];
        const timeUnixNano = lr.timeUnixNano ?? lr.observedTimeUnixNano;
        const timestamp = nanoToDate(timeUnixNano, now);
        const sessionId = str(merged["session.id"]);
        const promptId = str(merged["prompt.id"]);
        const eventSequence = num(merged["event.sequence"]);
        rows.push({
          dedupeKey: eventDedupeKey({
            timeUnixNano,
            timestamp,
            eventName,
            sessionId,
            promptId,
            eventSequence,
            attributes: merged,
          }),
          timestamp,
          sessionId,
          promptId,
          eventSequence,
          userId: str(merged["user.id"]),
          userEmail: str(merged["user.email"]),
          organizationId: str(merged["organization.id"]),
          accountUuid: str(merged["user.account_uuid"]),
          appVersion: str(merged["app.version"]),
          terminalType: str(merged["terminal.type"]),
          eventName,
          toolName: str(merged["tool_name"]),
          decision: str(merged["decision"]),
          decisionSource: str(merged["source"] ?? merged["decision_source"]),
          success: bool(merged["success"]),
          durationMs: num(merged["duration_ms"]),
          model: str(merged["model"]),
          statusCode: num(merged["status_code"]),
          errorType: str(merged["error_type"]),
          entrypoint: str(merged["app.entrypoint"]),
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
