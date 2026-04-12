import { NextResponse } from "next/server";
import { withRole } from "@/lib/auth-guard";
import { isGoogleWorkspaceConfigured } from "@/lib/google-workspace";
import { getSetting, GOOGLE_SETTINGS_KEYS } from "@/lib/settings";
import { matchDomain, resolveAIToolMatch } from "@/lib/ai-tools-registry";

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
      const appNames = new Map<string, {
        count: number;
        matched: boolean;
        matchedTool: string | null;
        confidence: string | null;
        reasons: string[];
        candidate: boolean;
      }>();

      for (const item of items) {
        const params = item.events?.[0]?.parameters ?? [];
        const appName =
          params.find((p) => p.name === "app_name")?.value ??
          params.find((p) => p.name === "client_id")?.value ??
          "unknown";
        const scopes = params.find((p) => p.name === "scope")?.multiValue ?? [];
        const joined = [appName, ...scopes].join(" ");
        const domains = Array.from(
          new Set(
            Array.from(
              joined.matchAll(/\b([a-z0-9-]+\.)+[a-z]{2,}\b/gi)
            ).map((match) => match[0].toLowerCase().replace(/^www\./, ""))
          )
        );

        const existing = appNames.get(appName);
        if (existing) {
          existing.count++;
        } else {
          const match =
            resolveAIToolMatch({ clientName: appName, scopes, domains }) ??
            domains
              .map((domain) => {
                const tool = matchDomain(domain);
                return tool
                  ? {
                      tool,
                      confidence: "medium" as const,
                      score: 7,
                      reasons: [`domain matched "${domain}"`],
                    }
                  : null;
              })
              .find(Boolean) ??
            null;
          const candidate =
            !match &&
            /(ai|gpt|copilot|claude|gemini|llm|openai|anthropic|mistral|cursor)/i.test(joined);
          appNames.set(appName, {
            count: 1,
            matched: !!match,
            matchedTool: match?.tool.toolName ?? null,
            confidence: match?.confidence ?? (candidate ? "low" : null),
            reasons: match?.reasons ?? (candidate ? ["heuristic AI keyword match"] : []),
            candidate,
          });
        }
      }

      // Sort by count descending
      const sortedApps = Array.from(appNames.entries())
        .map(([name, info]) => ({ appName: name, ...info }))
        .sort((a, b) => b.count - a.count);

      const aiMatches = sortedApps.filter((a) => a.matched);
      const candidateApps = sortedApps.filter((a) => !a.matched && a.candidate);
      const nonAiApps = sortedApps.filter((a) => !a.matched && !a.candidate);

      return NextResponse.json({
        configured: true,
        serviceAccount: key.client_email,
        adminEmail,
        lookbackDays: 30,
        totalEvents: items.length,
        uniqueApps: sortedApps.length,
        aiToolsMatched: aiMatches.length,
        aiMatches,
        lowConfidenceCandidates: candidateApps.slice(0, 20),
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
