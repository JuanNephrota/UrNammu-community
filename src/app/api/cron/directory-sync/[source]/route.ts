import { NextRequest, NextResponse } from "next/server";
import { runScheduledDirectorySync } from "@/lib/background-jobs";
import { unauthorizedCronResponse } from "@/lib/cron-auth";
import { DIRECTORY_SYNC_SOURCES, isDirectorySyncSource } from "@/lib/provider-sync-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A full directory listing walks every user in the tenant (up to 100 pages);
// give each source its own budget like the discovery scans.
export const maxDuration = 300;

// GET /api/cron/directory-sync/<source> — invoked daily by Vercel Cron, one
// entry per identity source in vercel.json. Fails runs stuck in RUNNING for
// this source, then syncs when the source is enabled
// (`directory_sync_<source>_enabled`, default off), configured, idle, and
// past its interval (`directory_sync_<source>_interval_hours`, default 24).
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ source: string }> }
) {
  const unauthorized = unauthorizedCronResponse(req);
  if (unauthorized) return unauthorized;

  const { source } = await params;
  if (!isDirectorySyncSource(source)) {
    return NextResponse.json(
      {
        error: `Unknown directory source "${source}". Expected one of: ${DIRECTORY_SYNC_SOURCES.join(", ")}.`,
      },
      { status: 404 }
    );
  }

  const result = await runScheduledDirectorySync(source);
  return NextResponse.json(result);
}
