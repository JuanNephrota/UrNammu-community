import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { loadProxyHealthConfig } from "@/lib/azure-monitor";
import { runProxyHealthSync } from "@/lib/proxy-health-sync";

/**
 * Manual "Sync now" from the /proxy-health board. The same sync also runs on
 * a 15-minute schedule via /api/cron/proxy-health; see lib/proxy-health-sync.
 */
export async function POST() {
  return withRole(["ADMIN"], async (session) => {
    const config = await loadProxyHealthConfig();
    if (!config) {
      return NextResponse.json(
        {
          error:
            "Azure Monitor is not configured. Set subscription ID, resource group, and function app name in Settings → General.",
        },
        { status: 400 }
      );
    }

    const result = await runProxyHealthSync(config, session.user.userId);
    if (result.ok) {
      return NextResponse.json(result.snapshot);
    }
    return NextResponse.json(
      { ...result.snapshot, error: result.error },
      { status: 502 }
    );
  });
}
