import { NextRequest, NextResponse } from "next/server";
import { runScheduledProviderSync } from "@/lib/background-jobs";
import { unauthorizedCronResponse } from "@/lib/cron-auth";
import { isSyncProvider, SYNC_PROVIDERS } from "@/lib/provider-sync-schedule";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// One provider per function. Admin APIs paginate slowly (Cursor usage events,
// Anthropic 7-day reports), so give each sync its own five-minute budget
// instead of sharing the old 60-second maintenance window nine ways.
export const maxDuration = 300;

// GET /api/cron/provider-sync/<provider> — invoked hourly by Vercel Cron, one
// entry per provider in vercel.json. The route checks the provider's own
// enable flag and interval (provider_sync_<provider>_*, falling back to the
// global provider_sync_* keys) and only syncs when due.
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const unauthorized = unauthorizedCronResponse(req);
  if (unauthorized) return unauthorized;

  const { provider } = await params;
  if (!isSyncProvider(provider)) {
    return NextResponse.json(
      { error: `Unknown provider "${provider}". Expected one of: ${SYNC_PROVIDERS.join(", ")}.` },
      { status: 404 }
    );
  }

  const result = await runScheduledProviderSync(provider);
  return NextResponse.json(result);
}
