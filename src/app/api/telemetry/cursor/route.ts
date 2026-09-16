import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import {
  flattenCursorMetrics,
  otlpCursorMetricsPayloadSchema,
} from "@/lib/validations/cursor-telemetry";

// Derived cursor.* metrics arrive from the collector's spanmetrics connector.
// Volume is low (batched), but the row ceiling below still applies.
export const maxDuration = 60;

// Ceiling on flattened rows per request, to protect the DB from a runaway or
// hostile batch. Override with TELEMETRY_MAX_ROWS.
const MAX_ROWS = Number(process.env.TELEMETRY_MAX_ROWS) || 5000;

// Dedicated Cursor ingest secret so it can be rotated independently of the
// Claude Code token. Falls back to the env var when the AppSetting is unset.
async function authorize(req: NextRequest): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const token = match[1];
  const expected =
    (await getSetting("cursor_telemetry_secret")) ??
    process.env.CURSOR_TELEMETRY_SECRET;
  if (!expected) return false;
  // Constant-time compare
  if (token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) {
    diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  if (!(await authorize(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = otlpCursorMetricsPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid OTLP metrics payload" },
      { status: 400 },
    );
  }

  const rows = flattenCursorMetrics(parsed.data);
  if (rows.length === 0) {
    // Benign: either non-cursor metrics got through, or it was a heartbeat.
    return NextResponse.json({ accepted: 0, duplicates: 0 }, { status: 202 });
  }
  if (rows.length > MAX_ROWS) {
    console.warn(
      `[telemetry/cursor] rejected batch of ${rows.length} rows (ceiling ${MAX_ROWS})`,
    );
    return NextResponse.json(
      { error: "Payload too large", rows: rows.length, max: MAX_ROWS },
      { status: 413 },
    );
  }

  // `dedupeKey` (unique) + skipDuplicates make collector retries idempotent;
  // `count` is the number actually inserted.
  const { count } = await prisma.cursorMetric.createMany({
    skipDuplicates: true,
    data: rows.map((r) => ({
      dedupeKey: r.dedupeKey,
      timestamp: r.timestamp,
      serviceName: r.serviceName,
      sessionId: r.sessionId,
      userId: r.userId,
      userEmail: r.userEmail,
      appVersion: r.appVersion,
      metricName: r.metricName,
      value: r.value,
      unit: r.unit,
      spanName: r.spanName,
      spanKind: r.spanKind,
      genAiToolName: r.genAiToolName,
      hookEvent: r.hookEvent,
      attributes: r.attributes as Prisma.InputJsonValue,
    })),
  });

  return NextResponse.json(
    { accepted: count, duplicates: rows.length - count },
    { status: 202 },
  );
}
