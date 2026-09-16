import { NextRequest, NextResponse } from "next/server";
import { loadProxyHealthConfig } from "@/lib/azure-monitor";
import { runProxyHealthSync, SYSTEM_ACTOR } from "@/lib/proxy-health-sync";
import { bearerTokenMatches } from "@/lib/secret-compare";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// GET /api/cron/proxy-health — invoked by Vercel Cron every 15 minutes.
// Pulls one Azure Monitor window into ProxyHealthSnapshot so the board's
// "last synced" indicator stays fresh without an admin pressing "Sync now".
// Skips (200) when Azure Monitor is not configured so the cron stays quiet on
// installs that don't use it.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !bearerTokenMatches(authHeader, cronSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const config = await loadProxyHealthConfig();
  if (!config) {
    return NextResponse.json({ skipped: "Azure Monitor is not configured" });
  }

  const result = await runProxyHealthSync(config, SYSTEM_ACTOR);
  if (result.ok) {
    return NextResponse.json({
      synced: true,
      snapshotId: result.snapshot.id,
      capturedAt: result.snapshot.capturedAt,
    });
  }
  // The failed attempt is persisted (with syncError) so the board can show
  // it; surface a non-2xx so the Vercel cron log also records the failure.
  return NextResponse.json(
    {
      synced: false,
      snapshotId: result.snapshot.id,
      capturedAt: result.snapshot.capturedAt,
      error: result.error,
    },
    { status: 502 }
  );
}
