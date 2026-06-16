import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { runProviderSyncJob } from "@/lib/background-jobs";
import {
  getAdminSyncOverview,
} from "@/lib/provider-telemetry";

export const maxDuration = 60;

/**
 * GET: Fetch live org data plus recent sync status for the oversight dashboard.
 */
export async function GET() {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async () => {
    const overview = await getAdminSyncOverview();
    return NextResponse.json(overview);
  });
}

/**
 * POST: Sync provider telemetry into normalized tables and preserve derived usage rows for
 * the existing oversight dashboard until the UI fully migrates to the new telemetry model.
 */
export async function POST() {
  return withRole(["ADMIN", "COMPLIANCE_OFFICER"], async (session) => {
    const results = await runProviderSyncJob(session.user.userId);
    return NextResponse.json(results);
  });
}
