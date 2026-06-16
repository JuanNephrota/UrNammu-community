import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import {
  flattenCursorMetrics,
  otlpCursorMetricsPayloadSchema,
} from "@/lib/validations/cursor-telemetry";

// Derived cursor.* metrics arrive from the collector's spanmetrics connector.
// Volume is low (batched), but keep a ceiling to protect the DB.
export const maxDuration = 60;

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
    return NextResponse.json({ accepted: 0 }, { status: 202 });
  }

  await prisma.cursorMetric.createMany({
    data: rows.map((r) => ({
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

  return NextResponse.json({ accepted: rows.length }, { status: 202 });
}
