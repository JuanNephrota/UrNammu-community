import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";

/**
 * Scheduled retention job for Claude Code OTel metrics. Hit by Vercel Cron
 * via vercel.json. Guarded by `Authorization: Bearer $CRON_SECRET`.
 *
 * Deletes rows in ClaudeCodeMetric older than the configured retention
 * window. The `timestamp` column is the OTel data-point wall-clock, which
 * is what the UI filters on — so retention is measured in client time, not
 * server-received time. An index on `timestamp` keeps the delete cheap.
 *
 * Config:
 *   claude_code_telemetry_retention_days   — integer, default 30
 *                                            set to 0 to disable pruning
 */
export const CLAUDE_CODE_METRIC_DEFAULT_RETENTION_DAYS = 30;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configured = await getSetting("claude_code_telemetry_retention_days");
  const parsed = configured == null ? NaN : Number.parseInt(configured, 10);
  const retentionDays = Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : CLAUDE_CODE_METRIC_DEFAULT_RETENTION_DAYS;

  if (retentionDays === 0) {
    return NextResponse.json({
      skipped: true,
      reason: "retention disabled (claude_code_telemetry_retention_days=0)",
    });
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const { count } = await prisma.claudeCodeMetric.deleteMany({
    where: { timestamp: { lt: cutoff } },
  });

  return NextResponse.json({
    deleted: count,
    cutoff: cutoff.toISOString(),
    retentionDays,
  });
}
