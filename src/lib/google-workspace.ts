import { google } from "googleapis";
import { JWT } from "google-auth-library";
import { matchAITool } from "./ai-tools-registry";
import { getSetting, GOOGLE_SETTINGS_KEYS } from "./settings";

export interface ScanDiscovery {
  toolName: string;
  vendor: string;
  domain: string;
  userEmails: string[];
  userCount: number;
}

export interface FullScanResult {
  discoveries: ScanDiscovery[];
  totalEventsScanned: number;
  aiToolsFound: number;
}

/**
 * Check if Google Workspace scanning is configured.
 * Checks DB settings first, then env vars.
 */
export async function isGoogleWorkspaceConfigured(): Promise<boolean> {
  const serviceKey =
    (await getSetting(GOOGLE_SETTINGS_KEYS.SERVICE_ACCOUNT_KEY)) ??
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const adminEmail =
    (await getSetting(GOOGLE_SETTINGS_KEYS.ADMIN_EMAIL)) ??
    process.env.GOOGLE_ADMIN_EMAIL;
  return !!(serviceKey && adminEmail);
}

/**
 * Create a JWT auth client for Google Admin SDK.
 * Reads credentials from DB settings, falling back to env vars.
 */
async function getAuthClient(): Promise<JWT> {
  const keyData =
    (await getSetting(GOOGLE_SETTINGS_KEYS.SERVICE_ACCOUNT_KEY)) ??
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const adminEmail =
    (await getSetting(GOOGLE_SETTINGS_KEYS.ADMIN_EMAIL)) ??
    process.env.GOOGLE_ADMIN_EMAIL;

  if (!keyData || !adminEmail) {
    throw new Error("Google Workspace not configured");
  }

  let key: { client_email: string; private_key: string };

  try {
    if (keyData.startsWith("{")) {
      key = JSON.parse(keyData);
    } else {
      key = JSON.parse(Buffer.from(keyData, "base64").toString("utf-8"));
    }
  } catch {
    throw new Error("Invalid service account key format");
  }

  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [
      "https://www.googleapis.com/auth/admin.reports.audit.readonly",
      "https://www.googleapis.com/auth/admin.directory.user.security",
    ],
    subject: adminEmail,
  });
}

/**
 * Scan OAuth token authorization events from the Reports API.
 * This discovers AI tools that users have authorized via "Sign in with Google".
 */
export async function scanTokenActivity(
  lookbackDays: number = 30
): Promise<{ events: TokenEvent[]; totalScanned: number }> {
  const auth = await getAuthClient();
  const service = google.admin({ version: "reports_v1", auth });

  const startTime = new Date();
  startTime.setDate(startTime.getDate() - lookbackDays);

  const events: TokenEvent[] = [];
  let pageToken: string | undefined;
  let totalScanned = 0;

  do {
    const response = await service.activities.list({
      userKey: "all",
      applicationName: "token",
      startTime: startTime.toISOString(),
      maxResults: 1000,
      pageToken,
    });

    const items = response.data.items ?? [];
    totalScanned += items.length;

    for (const item of items) {
      const params = item.events?.[0]?.parameters ?? [];
      const appName =
        params.find((p) => p.name === "app_name")?.value ??
        params.find((p) => p.name === "client_id")?.value ??
        "";
      const scopes = params
        .find((p) => p.name === "scope")
        ?.multiValue ?? [];

      if (appName) {
        events.push({
          appName,
          scopes,
          userEmail: item.actor?.email ?? "unknown",
          timestamp: item.id?.time ?? new Date().toISOString(),
        });
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { events, totalScanned };
}

interface TokenEvent {
  appName: string;
  scopes: string[];
  userEmail: string;
  timestamp: string;
}

/**
 * List all OAuth tokens for a specific user via the Directory API.
 */
export async function scanUserTokens(
  userEmail: string
): Promise<{ toolName: string; vendor: string; domain: string }[]> {
  const auth = await getAuthClient();
  const service = google.admin({ version: "directory_v1", auth });

  const response = await service.tokens.list({ userKey: userEmail });
  const tokens = response.data.items ?? [];
  const results: { toolName: string; vendor: string; domain: string }[] = [];

  for (const token of tokens) {
    const displayText = token.displayText ?? "";
    const scopes = token.scopes ?? [];
    const match = matchAITool(displayText, scopes);

    if (match) {
      results.push({
        toolName: match.toolName,
        vendor: match.vendor,
        domain: match.domains[0],
      });
    }
  }

  return results;
}

/**
 * Run a full scan: scan token activity events and aggregate discoveries.
 */
export async function runFullScan(
  lookbackDays: number = 30
): Promise<FullScanResult> {
  const { events, totalScanned } = await scanTokenActivity(lookbackDays);

  // Match events against known AI tools and aggregate
  const discoveryMap = new Map<string, ScanDiscovery>();

  for (const event of events) {
    const match = matchAITool(event.appName, event.scopes);
    if (!match) continue;

    const key = `${match.toolName}::${match.domains[0]}`;
    const existing = discoveryMap.get(key);

    if (existing) {
      if (!existing.userEmails.includes(event.userEmail)) {
        existing.userEmails.push(event.userEmail);
        existing.userCount = existing.userEmails.length;
      }
    } else {
      discoveryMap.set(key, {
        toolName: match.toolName,
        vendor: match.vendor,
        domain: match.domains[0],
        userEmails: [event.userEmail],
        userCount: 1,
      });
    }
  }

  const discoveries = Array.from(discoveryMap.values());

  return {
    discoveries,
    totalEventsScanned: totalScanned,
    aiToolsFound: discoveries.length,
  };
}
