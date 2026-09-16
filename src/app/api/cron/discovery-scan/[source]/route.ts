import { NextRequest, NextResponse } from "next/server";
import { runScheduledDiscoveryScan } from "@/lib/background-jobs";
import { unauthorizedCronResponse } from "@/lib/cron-auth";
import { DISCOVERY_SCAN_SOURCES, isDiscoveryScanSource } from "@/lib/provider-sync-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Directory and endpoint scans enumerate every user / device; give each source
// its own budget rather than sharing one window with the provider syncs.
export const maxDuration = 300;

// GET /api/cron/discovery-scan/<source> — invoked hourly by Vercel Cron, one
// entry per shadow-AI source in vercel.json. Fails scans stuck in `running`
// for this source, then scans when the source is enabled, configured, idle,
// and past its configured interval (Settings → Shadow AI).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  const unauthorized = unauthorizedCronResponse(req);
  if (unauthorized) return unauthorized;

  const { source } = await params;
  if (!isDiscoveryScanSource(source)) {
    return NextResponse.json(
      { error: `Unknown scan source "${source}". Expected one of: ${DISCOVERY_SCAN_SOURCES.join(", ")}.` },
      { status: 404 }
    );
  }

  const result = await runScheduledDiscoveryScan(source);
  return NextResponse.json(result);
}
