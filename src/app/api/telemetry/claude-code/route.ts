import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import {
  flattenOtlpMetrics,
  otlpMetricsPayloadSchema,
} from "@/lib/validations/claude-code-telemetry";

// OTLP payloads can be chunky when a client reconnects and flushes a backlog.
// Keep a ceiling to protect the DB; the Collector's batch processor is set
// to 1000 data points per flush which fits comfortably under this.
export const maxDuration = 60;

async function authorize(req: NextRequest): Promise<boolean> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const token = match[1];
  const expected =
    (await getSetting("claude_code_telemetry_secret")) ??
    process.env.CLAUDE_CODE_TELEMETRY_SECRET;
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

  const parsed = otlpMetricsPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid OTLP metrics payload" },
      { status: 400 },
    );
  }

  const rows = flattenOtlpMetrics(parsed.data);
  if (rows.length === 0) {
    // Benign: either non-claude_code metrics got through, or it was a heartbeat.
    return NextResponse.json({ accepted: 0 }, { status: 202 });
  }

  // Prisma's createMany doesn't return rows, which is fine — we're a sink.
  // skipDuplicates isn't meaningful here (cuid ids), left off for clarity.
  await prisma.claudeCodeMetric.createMany({
    data: rows.map((r) => ({
      timestamp: r.timestamp,
      userId: r.userId,
      userEmail: r.userEmail,
      sessionId: r.sessionId,
      organizationId: r.organizationId,
      accountUuid: r.accountUuid,
      appVersion: r.appVersion,
      hostType: r.hostType,
      osType: r.osType,
      osVersion: r.osVersion,
      terminalType: r.terminalType,
      metricName: r.metricName,
      value: r.value,
      unit: r.unit,
      model: r.model,
      tokenType: r.tokenType,
      tool: r.tool,
      decision: r.decision,
      linesType: r.linesType,
      attributes: r.attributes as Prisma.InputJsonValue,
    })),
  });

  return NextResponse.json({ accepted: rows.length }, { status: 202 });
}
