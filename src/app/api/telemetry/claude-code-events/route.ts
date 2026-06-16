import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import {
  flattenOtlpLogs,
  otlpLogsPayloadSchema,
} from "@/lib/validations/claude-code-telemetry";
import { analyzePromptRisk, createPromptRiskAlert } from "@/lib/prompt-risk";

// Events are higher-volume than metrics; the Collector's batch processor is
// capped at 1000 records per flush which fits comfortably under this.
export const maxDuration = 60;

// Same bearer secret as the metrics endpoint — the Collector presents one
// token for both signals. Falls back to the env var when the AppSetting is
// unset, mirroring /api/telemetry/claude-code.
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

  const parsed = otlpLogsPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid OTLP logs payload" },
      { status: 400 },
    );
  }

  // flattenOtlpLogs drops records without an event.name, strips sensitive
  // content keys from the stored attribute bag, and surfaces user_prompt
  // text on the transient `promptText` field for risk analysis only.
  const rows = flattenOtlpLogs(parsed.data);
  if (rows.length === 0) {
    return NextResponse.json({ accepted: 0 }, { status: 202 });
  }

  // ── Dangerous-prompt detection (Option A: analyze in-memory, persist
  //    only the verdict). The raw prompt is never written to the DB — we
  //    read promptText here, run the same rule engine the proxy uses, store
  //    severity/category on the event row, and raise an alert on a match
  //    (the alert keeps only a sanitized excerpt). promptText is discarded.
  let flaggedCount = 0;
  const analyses = await Promise.all(
    rows.map((r) =>
      r.eventName === "user_prompt" && r.promptText
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
      provider: "claude_code",
      model: rows[i].model ?? "claude-code",
      department: null,
      userEmail: rows[i].userEmail,
      analysis,
    });
  }

  await prisma.claudeCodeEvent.createMany({
    data: rows.map((r) => ({
      timestamp: r.timestamp,
      sessionId: r.sessionId,
      promptId: r.promptId,
      eventSequence: r.eventSequence,
      userId: r.userId,
      userEmail: r.userEmail,
      organizationId: r.organizationId,
      accountUuid: r.accountUuid,
      appVersion: r.appVersion,
      terminalType: r.terminalType,
      eventName: r.eventName,
      toolName: r.toolName,
      decision: r.decision,
      decisionSource: r.decisionSource,
      success: r.success,
      durationMs: r.durationMs,
      model: r.model,
      statusCode: r.statusCode,
      errorType: r.errorType,
      entrypoint: r.entrypoint,
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
