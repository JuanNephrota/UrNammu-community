import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import {
  flattenOtlpSpans,
  otlpTracesPayloadSchema,
} from "@/lib/validations/cursor-telemetry";
import { analyzePromptRisk, createPromptRiskAlert } from "@/lib/prompt-risk";

// Raw Cursor spans. Higher-volume than the derived metrics; the collector's
// batch processor is capped per flush which fits comfortably under this.
export const maxDuration = 60;

// Same dedicated Cursor secret as the metrics endpoint — the collector
// presents one token for both Cursor signals. Falls back to the env var.
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

  const parsed = otlpTracesPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid OTLP traces payload" },
      { status: 400 },
    );
  }

  // flattenOtlpSpans strips sensitive content keys from the stored attribute
  // bag and surfaces beforeSubmitPrompt text on the transient `promptText`
  // field for risk analysis only.
  const rows = flattenOtlpSpans(parsed.data);
  if (rows.length === 0) {
    return NextResponse.json({ accepted: 0 }, { status: 202 });
  }

  // ── Dangerous-prompt detection (Option A: analyze in-memory, persist only
  //    the verdict). Mirrors the Claude Code events route. The raw prompt is
  //    never written to the DB — we read promptText here, run the same rule
  //    engine the proxy uses, store severity/category on the span row, and
  //    raise an alert on a match (the alert keeps only a sanitized excerpt).
  let flaggedCount = 0;
  const analyses = await Promise.all(
    rows.map((r) =>
      r.promptText
        ? analyzePromptRisk({ prompt: r.promptText })
        : Promise.resolve(null),
    ),
  );
  for (let i = 0; i < rows.length; i++) {
    const analysis = analyses[i];
    if (!analysis?.flagged) continue;
    flaggedCount++;
    rows[i].riskSeverity = analysis.severity;
    rows[i].riskCategory =
      analysis.categories.join(", ") || analysis.ruleKeys.join(", ") || null;
    // Sequential to avoid racing the alert-dedup window.
    await createPromptRiskAlert({
      provider: "cursor",
      model: rows[i].genAiModel ?? "cursor",
      department: null,
      userEmail: rows[i].userEmail,
      analysis,
    });
  }

  await prisma.cursorSpan.createMany({
    data: rows.map((r) => ({
      timestamp: r.timestamp,
      traceId: r.traceId,
      spanId: r.spanId,
      parentSpanId: r.parentSpanId,
      sessionId: r.sessionId,
      serviceName: r.serviceName,
      userId: r.userId,
      userEmail: r.userEmail,
      appVersion: r.appVersion,
      spanName: r.spanName,
      spanKind: r.spanKind,
      hookEvent: r.hookEvent,
      genAiSystem: r.genAiSystem,
      genAiModel: r.genAiModel,
      genAiOperation: r.genAiOperation,
      genAiToolName: r.genAiToolName,
      durationMs: r.durationMs == null ? null : Math.round(r.durationMs),
      success: r.success,
      riskSeverity: r.riskSeverity,
      riskCategory: r.riskCategory,
      // NOTE: r.promptText is intentionally NOT persisted.
      attributes: r.attributes as Prisma.InputJsonValue,
    })),
  });

  return NextResponse.json(
    { accepted: rows.length, flagged: flaggedCount },
    { status: 202 },
  );
}
