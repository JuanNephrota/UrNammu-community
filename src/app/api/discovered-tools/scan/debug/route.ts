import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { isGoogleWorkspaceConfigured } from "@/lib/google-workspace";
import { getSetting, GOOGLE_SETTINGS_KEYS } from "@/lib/settings";
import { matchAITool } from "@/lib/ai-tools-registry";

/**
 * Debug endpoint — tests Google Workspace connection and returns raw scan diagnostics.
 * Only available to ADMIN users.
 */
export async function GET() {
  return withRole(["ADMIN"], async () => {
    const configured = await isGoogleWorkspaceConfigured();
    if (!configured) {
      return NextResponse.json({ configured: false, error: "Google Workspace not configured" });
    }

    const adminEmail =
      (await getSetting(GOOGLE_SETTINGS_KEYS.ADMIN_EMAIL)) ??
      process.env.GOOGLE_ADMIN_EMAIL;

    try {
      // Build auth client
      const keyData =
        (await getSetting(GOOGLE_SETTINGS_KEYS.SERVICE_ACCOUNT_KEY)) ??
        process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

      let key: { client_email: string; private_key: string };
      if (keyData!.startsWith("{")) {
        key = JSON.parse(keyData!);
      } else {
        key = JSON.parse(Buffer.from(keyData!, "base64").toString("utf-8"));
      }

      const { JWT } = await import("google-auth-library");
      const { google } = await import("googleapis");

      const authClient = new JWT({
        email: key.client_email,
        key: key.private_key,
        scopes: [
          "https://www.googleapis.com/auth/admin.reports.audit.readonly",
        ],
        subject: adminEmail,
      });

      await authClient.authorize();

      // Query token activity events
      const service = google.admin({ version: "reports_v1", auth: authClient });
      const startTime = new Date();
      startTime.setDate(startTime.getDate() - 30);

      const response = await service.activities.list({
        userKey: "all",
        applicationName: "token",
        startTime: startTime.toISOString(),
        maxResults: 500,
      });

      const items = response.data.items ?? [];

      // Collect all unique app names and check which match AI tools
      const appNames = new Map<string, { count: number; matched: boolean; matchedTool: string | null }>();

      for (const item of items) {
        const params = item.events?.[0]?.parameters ?? [];
        const appName =
          params.find((p) => p.name === "app_name")?.value ??
          params.find((p) => p.name === "client_id")?.value ??
          "unknown";
        const scopes = params.find((p) => p.name === "scope")?.multiValue ?? [];

        const existing = appNames.get(appName);
        if (existing) {
          existing.count++;
        } else {
          const match = matchAITool(appName, scopes);
          appNames.set(appName, {
            count: 1,
            matched: !!match,
            matchedTool: match?.toolName ?? null,
          });
        }
      }

      // Sort by count descending
      const sortedApps = Array.from(appNames.entries())
        .map(([name, info]) => ({ appName: name, ...info }))
        .sort((a, b) => b.count - a.count);

      const aiMatches = sortedApps.filter((a) => a.matched);
      const nonAiApps = sortedApps.filter((a) => !a.matched);

      return NextResponse.json({
        configured: true,
        serviceAccount: key.client_email,
        adminEmail,
        lookbackDays: 30,
        totalEvents: items.length,
        uniqueApps: sortedApps.length,
        aiToolsMatched: aiMatches.length,
        aiMatches,
        topNonAiApps: nonAiApps.slice(0, 20),
        hasMorePages: !!response.data.nextPageToken,
      });
    } catch (err) {
      return NextResponse.json({
        configured: true,
        error: err instanceof Error ? err.message : "Unknown error",
        errorType: err instanceof Error ? err.constructor.name : "Unknown",
      });
    }
  });
}
