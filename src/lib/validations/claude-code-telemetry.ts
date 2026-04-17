import { z } from "zod";

// ─── OTLP/JSON metric shape (subset we actually consume) ──
// The spec lives at https://opentelemetry.io/docs/specs/otlp/ — we only
// validate the pieces we read, and stash the rest in `attributes` JSON.

const anyValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    stringValue: z.string().optional(),
    boolValue: z.boolean().optional(),
    intValue: z.union([z.string(), z.number()]).optional(),
    doubleValue: z.number().optional(),
    arrayValue: z
      .object({
        values: z.array(anyValueSchema).optional(),
      })
      .optional(),
    kvlistValue: z
      .object({
        values: z.array(z.record(z.string(), z.unknown())).optional(),
      })
      .optional(),
  }),
);

const keyValueSchema = z.object({
  key: z.string(),
  value: anyValueSchema.optional(),
});

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
  count: z.union([z.string(), z.number()]).optional(),
  sum: z.number().optional(),
});

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

// ─── Helpers ─────────────────────────────────────────────

type AnyValue = z.infer<typeof anyValueSchema>;

export function readAnyValue(v: AnyValue | undefined): unknown {
  if (!v || typeof v !== "object") return undefined;
  const obj = v as Record<string, unknown>;
  if ("stringValue" in obj) return obj.stringValue;
  if ("boolValue" in obj) return obj.boolValue;
  if ("intValue" in obj) {
    const raw = obj.intValue;
    return typeof raw === "string" ? Number(raw) : raw;
  }
  if ("doubleValue" in obj) return obj.doubleValue;
  return undefined;
}

export function attributesToMap(
  attrs: Array<{ key: string; value?: AnyValue }> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kv of attrs ?? []) {
    out[kv.key] = readAnyValue(kv.value);
  }
  return out;
}

export function nanoToDate(
  nano: string | number | undefined,
  fallback: Date,
): Date {
  if (nano == null) return fallback;
  // Avoid BigInt literals (require ES2020 target). Strings are divided as
  // text → number safely for the ~10^18 nano range we see from OTel.
  if (typeof nano === "number") return new Date(Math.trunc(nano / 1_000_000));
  // Trim last 6 digits (ns → ms) lexically; falls back if the string is
  // shorter than 7 chars (rare, but don't crash).
  const trimmed =
    nano.length > 6 ? nano.slice(0, -6) : "0";
  const ms = Number(trimmed);
  return Number.isFinite(ms) ? new Date(ms) : fallback;
}

export function readDataPointValue(point: {
  asDouble?: number;
  asInt?: string | number;
}): number {
  if (typeof point.asDouble === "number") return point.asDouble;
  if (point.asInt != null) {
    return typeof point.asInt === "string" ? Number(point.asInt) : point.asInt;
  }
  return 0;
}

// ─── Flattening ──────────────────────────────────────────

export interface FlattenedMetric {
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

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
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
        const dataPoints = [
          ...(m.sum?.dataPoints ?? []),
          ...(m.gauge?.dataPoints ?? []),
        ];
        for (const dp of dataPoints) {
          const pointAttrs = attributesToMap(dp.attributes);
          const merged: Record<string, unknown> = {
            ...resourceAttrs,
            ...pointAttrs,
          };
          rows.push({
            timestamp: nanoToDate(dp.timeUnixNano, now),
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
            value: readDataPointValue(dp),
            unit: m.unit ?? null,
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
