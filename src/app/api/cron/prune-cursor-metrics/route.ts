import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting } from "@/lib/settings";
import { bearerTokenMatches } from "@/lib/secret-compare";

/**
 * Scheduled retention job for Cursor OTel telemetry. Hit by Vercel Cron via
 * vercel.json. Guarded by `Authorization: Bearer $CRON_SECRET`.
 *
 * Deletes rows in CursorMetric AND CursorSpan older than the configured
 * retention window. The `timestamp` column is the OTel wall-clock, which is
 * what the UI filters on — so retention is measured in client time, not
 * server-received time. Indexes on `timestamp` keep the deletes cheap.
 *
 * Config:
 *   cursor_telemetry_retention_days   — integer, default 30
 *                                       set to 0 to disable pruning
 */
export const CURSOR_METRIC_DEFAULT_RETENTION_DAYS = 30;

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !bearerTokenMatches(authHeader, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configured = await getSetting("cursor_telemetry_retention_days");
  const parsed = configured == null ? NaN : Number.parseInt(configured, 10);
  const retentionDays =
    Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : CURSOR_METRIC_DEFAULT_RETENTION_DAYS;

  if (retentionDays === 0) {
    return NextResponse.json({
      skipped: true,
      reason: "retention disabled (cursor_telemetry_retention_days=0)",
    });
  }

  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  const [metrics, spans] = await Promise.all([
    prisma.cursorMetric.deleteMany({ where: { timestamp: { lt: cutoff } } }),
    prisma.cursorSpan.deleteMany({ where: { timestamp: { lt: cutoff } } }),
  ]);

  return NextResponse.json({
    deletedMetrics: metrics.count,
    deletedSpans: spans.count,
    cutoff: cutoff.toISOString(),
    retentionDays,
  });
}
