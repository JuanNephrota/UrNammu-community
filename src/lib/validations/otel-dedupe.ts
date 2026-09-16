import { createHash } from "node:crypto";

// ─── Idempotency keys for OTel ingest ────────────────────
// The collector (ops/otel-collector/config.yaml) runs with `retry_on_failure`
// + `sending_queue`, so a batch whose HTTP call timed out after a partial DB
// write is re-sent verbatim. The ingest routes insert with cuid ids, so
// without a content-derived key every retry double-counts. Each flattener
// computes a deterministic `dedupeKey` per row from the fields that identify
// a unique OTel record; the routes pass it to
// `createMany({ skipDuplicates: true })` against a `@unique` column.
//
// Keys are computed AFTER sensitive-key stripping, so a payload that arrives
// with `prompt` (direct post) and one where the gateway already dropped it
// hash identically.

/** sha256 hex, truncated to 40 chars (160 bits — plenty for a unique column). */
const KEY_LENGTH = 40;

/**
 * Recursively sort object keys so `JSON.stringify` output is independent of
 * attribute insertion order. Arrays keep their order (OTLP arrays are
 * positional). `undefined` values are dropped (as JSON.stringify would).
 */
export function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (src[k] === undefined) continue;
      out[k] = canonicalize(src[k]);
    }
    return out;
  }
  return value;
}

/** Hash a bag of identifying fields into a fixed-length hex key. */
export function contentHash(parts: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(parts)))
    .digest("hex")
    .slice(0, KEY_LENGTH);
}

/**
 * Canonical form of an OTLP unix-nano timestamp for hashing. Strings are
 * used verbatim (no precision loss); numbers are stringified. When the record
 * carries no timestamp the flattener stamps it with the server clock, so we
 * fall back to that resolved value — such rows can't be deduped across
 * retries, but they stay distinct from each other.
 */
export function nanoKey(
  nano: string | number | undefined,
  fallback: Date,
): string {
  if (typeof nano === "string" && nano.length > 0) return nano;
  if (typeof nano === "number" && Number.isFinite(nano)) return String(nano);
  return `ms:${fallback.getTime()}`;
}

/**
 * Metric data point (Claude Code `claude_code.*` and Cursor `cursor.*`):
 * timestamp + metric name + value + unit + the merged (resource + point)
 * attribute bag.
 */
export function metricDedupeKey(input: {
  timeUnixNano: string | number | undefined;
  timestamp: Date;
  metricName: string;
  value: number;
  unit: string | null;
  attributes: Record<string, unknown>;
}): string {
  return contentHash({
    t: nanoKey(input.timeUnixNano, input.timestamp),
    name: input.metricName,
    value: input.value,
    unit: input.unit,
    attrs: input.attributes,
  });
}

/**
 * Log record / event (Claude Code events): timestamp + event name + the
 * session/prompt/sequence triple + the stripped attribute bag.
 */
export function eventDedupeKey(input: {
  timeUnixNano: string | number | undefined;
  timestamp: Date;
  eventName: string;
  sessionId: string | null;
  promptId: string | null;
  eventSequence: number | null;
  attributes: Record<string, unknown>;
}): string {
  return contentHash({
    t: nanoKey(input.timeUnixNano, input.timestamp),
    event: input.eventName,
    session: input.sessionId,
    prompt: input.promptId,
    seq: input.eventSequence,
    attrs: input.attributes,
  });
}

/**
 * Span (Cursor traces): `traceId + spanId` is unique by construction, so
 * when both are present the key is derived from them alone. Otherwise fall
 * back to a content hash of the span's timing, name, parent, status, and
 * stripped attributes.
 */
export function spanDedupeKey(input: {
  traceId: string | null;
  spanId: string | null;
  startTimeUnixNano: string | number | undefined;
  endTimeUnixNano: string | number | undefined;
  timestamp: Date;
  spanName: string;
  parentSpanId: string | null;
  statusCode: number | string | undefined;
  attributes: Record<string, unknown>;
}): string {
  if (input.traceId && input.spanId) {
    return contentHash({ traceId: input.traceId, spanId: input.spanId });
  }
  return contentHash({
    start: nanoKey(input.startTimeUnixNano, input.timestamp),
    end:
      input.endTimeUnixNano == null ? null : String(input.endTimeUnixNano),
    name: input.spanName,
    parent: input.parentSpanId,
    status: input.statusCode ?? null,
    attrs: input.attributes,
  });
}
