import { NextRequest, NextResponse } from "next/server";
import { runKeyUsageRulesJob } from "@/lib/background-jobs";
import { unauthorizedCronResponse } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/key-usage-rules — invoked hourly by Vercel Cron. Evaluates
// key-usage rules against recent telemetry and refreshes ApiKeyProfile rows.
// A failed evaluation is reported in the body (ok: false) rather than thrown
// so one bad rule surfaces in the cron log without a 500.
export async function GET(req: NextRequest) {
  const unauthorized = unauthorizedCronResponse(req);
  if (unauthorized) return unauthorized;

  const result = await runKeyUsageRulesJob();
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
