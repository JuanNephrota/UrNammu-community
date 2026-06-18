import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSetting, SENSITIVE_SCAN_SETTINGS_KEYS } from "@/lib/settings";
import { executeSensitiveScan } from "@/lib/sensitive-scan-executor";
import { bearerTokenMatches } from "@/lib/secret-compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/sensitive-scan — invoked by Vercel Cron (daily).
// Runs the leakage-probe sweep against reachable AI endpoints when the module
// is enabled. Findings + alerts are persisted by the executor.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !bearerTokenMatches(authHeader, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const enabled = await getSetting(SENSITIVE_SCAN_SETTINGS_KEYS.ENABLED);
  if (enabled !== "true") {
    return NextResponse.json({ skipped: "Sensitive scanning is disabled" });
  }

  // Don't pile up on a scan that's already mid-flight.
  const runningScan = await prisma.sensitiveScan.findFirst({
    where: { status: "running" },
  });
  if (runningScan) {
    return NextResponse.json({ skipped: "A scan is already in progress" });
  }

  const result = await executeSensitiveScan("system");
  return NextResponse.json(result);
}
