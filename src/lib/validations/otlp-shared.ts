import { z } from "zod";

// ─── Shared OTLP/JSON primitives ─────────────────────────
// Schemas + readers common to the metrics, logs, and traces signals. Both the
// Claude Code (metrics + logs) and Cursor (traces → metrics) ingestion
// pipelines build on these. The full OTLP spec lives at
// https://opentelemetry.io/docs/specs/otlp/ — we validate only the pieces we
// read and stash the rest in an `attributes` JSON bag.

export const anyValueSchema: z.ZodType<unknown> = z.lazy(() =>
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

export const keyValueSchema = z.object({
  key: z.string(),
  value: anyValueSchema.optional(),
});

export type AnyValue = z.infer<typeof anyValueSchema>;

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
  const trimmed = nano.length > 6 ? nano.slice(0, -6) : "0";
  const ms = Number(trimmed);
  return Number.isFinite(ms) ? new Date(ms) : fallback;
}

/** Difference in ms between two OTLP unix-nano timestamps. Null if unusable. */
export function nanoDiffMs(
  startNano: string | number | undefined,
  endNano: string | number | undefined,
): number | null {
  if (startNano == null || endNano == null) return null;
  const start = typeof startNano === "string" ? Number(startNano) : startNano;
  const end = typeof endNano === "string" ? Number(endNano) : endNano;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const ms = (end - start) / 1_000_000;
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
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

// ─── Coercion helpers (shared by all flatteners) ─────────

export function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function bool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return null;
}
