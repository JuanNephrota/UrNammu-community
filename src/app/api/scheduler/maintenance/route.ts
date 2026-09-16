import { NextRequest, NextResponse } from "next/server";
import { MAINTENANCE_SHIM_DEPRECATION, runScheduledMaintenance } from "@/lib/background-jobs";
import { unauthorizedCronResponse } from "@/lib/cron-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * DEPRECATED compatibility shim — kept for one release so external schedulers
 * that still call the old hourly endpoint keep working. It runs the same
 * per-job functions as the dedicated `/api/cron/**` routes but inside a single
 * 60-second function, which is exactly the problem those routes fix. Move your
 * scheduler to the per-job routes listed in vercel.json.
 */
export async function GET(req: NextRequest) {
  const unauthorized = unauthorizedCronResponse(req);
  if (unauthorized) return unauthorized;

  const result = await runScheduledMaintenance();
  return NextResponse.json(result, {
    headers: {
      Deprecation: "true",
      Link: '</api/cron/provider-sync/anthropic>; rel="successor-version"',
      Warning: `299 - "${MAINTENANCE_SHIM_DEPRECATION}"`,
    },
  });
}
