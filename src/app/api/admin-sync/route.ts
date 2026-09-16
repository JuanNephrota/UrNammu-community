import { NextResponse } from "next/server";
import { z } from "zod";
import { withRole } from "@/lib/auth-guard";
import { runProviderSyncJob } from "@/lib/background-jobs";
import { getAdminSyncOverview } from "@/lib/provider-telemetry";
import {
  MAX_REQUEST_WINDOW_DAYS,
  parseRequestedWindow,
  SYNC_PROVIDERS,
  type SyncWindow,
} from "@/lib/provider-sync-window";

export const maxDuration = 60;

const adminSyncBodySchema = z.object({
  provider: z.enum(SYNC_PROVIDERS).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const WINDOW_ERRORS: Record<string, string> = {
  from_and_to_required: "Both `from` and `to` (ISO 8601) are required for a windowed sync.",
  invalid_date: "`from` and `to` must be valid ISO 8601 timestamps.",
  to_before_from: "`to` must be after `from`.",
  window_too_long: `A single request may cover at most ${MAX_REQUEST_WINDOW_DAYS} days; walk longer ranges in chunks.`,
};

/**
 * GET: Fetch live org data plus recent sync status and per-provider
 * watermarks for the oversight dashboard.
 */
export async function GET() {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async () => {
    const overview = await getAdminSyncOverview();
    return NextResponse.json(overview);
  });
}

/**
 * POST: Sync provider telemetry into normalized tables and preserve derived
 * usage rows for the existing oversight dashboard until the UI fully migrates
 * to the new telemetry model.
 *
 * Body (optional JSON):
 *   {}                              — every provider, window from its watermark
 *   { provider }                    — one provider, window from its watermark
 *   { provider, from, to }          — one provider, explicit window (backfill
 *                                     chunk; at most MAX_REQUEST_WINDOW_DAYS)
 */
export async function POST(request: Request) {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    let rawBody: unknown = {};
    const text = await request.text().catch(() => "");
    if (text.trim().length > 0) {
      try {
        rawBody = JSON.parse(text);
      } catch {
        return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
      }
    }

    const parsed = adminSyncBodySchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request body.", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const { provider, from, to } = parsed.data;
    let window: SyncWindow | undefined;
    if (from !== undefined || to !== undefined) {
      if (!provider) {
        return NextResponse.json(
          { error: "`provider` is required when `from` / `to` are given." },
          { status: 400 },
        );
      }
      const requested = parseRequestedWindow(from, to);
      if ("error" in requested) {
        return NextResponse.json({ error: WINDOW_ERRORS[requested.error] }, { status: 400 });
      }
      window = requested.window;
    }

    const results = await runProviderSyncJob(session.user.userId, { provider, window });
    return NextResponse.json(results);
  });
}
