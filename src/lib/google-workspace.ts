import { google } from "googleapis";
import { JWT } from "google-auth-library";
import {
  matchDomain,
  resolveAIToolMatch,
  type AIToolMatchResult,
} from "./ai-tools-registry";
import { getSetting, GOOGLE_SETTINGS_KEYS } from "./settings";

export interface ScanDiscovery {
  toolName: string;
  vendor: string;
  domain: string;
  userEmails: string[];
  userCount: number;
  notes?: string;
  matchConfidence?: "high" | "medium" | "low";
  matchScore?: number;
  matchReasons?: string[];
}

export interface FullScanResult {
  discoveries: ScanDiscovery[];
  totalEventsScanned: number;
  aiToolsFound: number;
}

type MatchConfidence = "high" | "medium" | "low";

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
 * Optimized for speed: limits pages, filters early, short timeout.
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
  let pageCount = 0;
  const maxPages = 5; // Limit pagination to stay within serverless timeout

  do {
    const response = await service.activities.list({
      userKey: "all",
      applicationName: "token",
      startTime: startTime.toISOString(),
      maxResults: 500,
      pageToken,
    });

    const items = response.data.items ?? [];
    totalScanned += items.length;
    pageCount++;

    for (const item of items) {
      const params = item.events?.[0]?.parameters ?? [];
      const eventName = item.events?.[0]?.name ?? "unknown";
      const appName =
        params.find((p) => p.name === "app_name")?.value ??
        params.find((p) => p.name === "client_id")?.value ??
        "";
      const scopes = params
        .find((p) => p.name === "scope")
        ?.multiValue ?? [];

      const candidateDomains = extractDomainsFromGoogleSignal(appName, scopes);
      const resolvedMatch =
        resolveAIToolMatch({
          clientName: appName,
          scopes,
          domains: candidateDomains,
          additionalText: [eventName],
        }) ??
        candidateDomains
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
        resolvedMatch ??
        (isLikelyAICandidate(appName, scopes, candidateDomains)
          ? buildLowConfidenceCandidate(appName, candidateDomains, scopes)
          : null);

      if (candidate) {
        events.push({
          appName,
          scopes,
          userEmail: item.actor?.email ?? "unknown",
          timestamp: item.id?.time ?? new Date().toISOString(),
          eventName,
          match: candidate,
          candidateDomains,
        });
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken && pageCount < maxPages);

  return { events, totalScanned };
}

interface TokenEvent {
  appName: string;
  scopes: string[];
  userEmail: string;
  timestamp: string;
  eventName: string;
  match: AIToolMatchResult;
  candidateDomains: string[];
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
    const candidateDomains = extractDomainsFromGoogleSignal(displayText, scopes);
    const match =
      resolveAIToolMatch({
        clientName: displayText,
        scopes,
        domains: candidateDomains,
      })?.tool ?? null;

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

  const discoveryMap = new Map<
    string,
    ScanDiscovery & {
      firstSeen: string;
      lastSeen: string;
      eventCount: number;
      activeDays: Set<string>;
      confidence: MatchConfidence;
      reasons: string[];
      lowConfidenceCandidate: boolean;
    }
  >();

  for (const event of events) {
    const match = event.match;
    const domain =
      event.candidateDomains[0] ?? match.tool.domains[0] ?? "unknown";
    const key = `${match.tool.toolName}::${domain}`;
    const existing = discoveryMap.get(key);
    const eventDay = new Date(event.timestamp).toISOString().slice(0, 10);

    if (existing) {
      if (!existing.userEmails.includes(event.userEmail)) {
        existing.userEmails.push(event.userEmail);
        existing.userCount = existing.userEmails.length;
      }
      existing.lastSeen =
        new Date(event.timestamp).getTime() > new Date(existing.lastSeen).getTime()
          ? event.timestamp
          : existing.lastSeen;
      existing.firstSeen =
        new Date(event.timestamp).getTime() < new Date(existing.firstSeen).getTime()
          ? event.timestamp
          : existing.firstSeen;
      existing.eventCount += 1;
      existing.activeDays.add(eventDay);
      existing.confidence =
        confidenceRank(match.confidence) > confidenceRank(existing.confidence)
          ? match.confidence
          : existing.confidence;
      existing.reasons = Array.from(new Set([...existing.reasons, ...match.reasons]));
    } else {
      discoveryMap.set(key, {
        toolName: match.tool.toolName,
        vendor: match.tool.vendor,
        domain,
        userEmails: [event.userEmail],
        userCount: 1,
        firstSeen: event.timestamp,
        lastSeen: event.timestamp,
        eventCount: 1,
        activeDays: new Set([eventDay]),
        confidence: match.confidence,
        reasons: match.reasons,
        lowConfidenceCandidate: match.confidence === "low",
      });
    }
  }

  const discoveries = Array.from(discoveryMap.values()).map((discovery) => ({
    toolName: discovery.toolName,
    vendor: discovery.vendor,
    domain: discovery.domain,
    userEmails: discovery.userEmails,
    userCount: discovery.userCount,
    matchConfidence: discovery.confidence,
    matchScore: discovery.confidence === "high" ? 12 : discovery.confidence === "medium" ? 7 : 3,
    matchReasons: discovery.reasons,
    notes: buildGoogleDiscoveryNotes({
      confidence: discovery.confidence,
      reasons: discovery.reasons,
      firstSeen: discovery.firstSeen,
      lastSeen: discovery.lastSeen,
      eventCount: discovery.eventCount,
      activeDays: discovery.activeDays.size,
      lowConfidenceCandidate: discovery.lowConfidenceCandidate,
    }),
  }));

  return {
    discoveries,
    totalEventsScanned: totalScanned,
    aiToolsFound: discoveries.length,
  };
}

function extractDomainsFromGoogleSignal(
  appName: string,
  scopes: string[]
): string[] {
  const domains = new Set<string>();
  const text = [appName, ...scopes].join(" ");
  const domainPattern = /\b([a-z0-9-]+\.)+[a-z]{2,}\b/gi;

  for (const match of text.matchAll(domainPattern)) {
    const candidate = match[0]?.toLowerCase().replace(/^www\./, "");
    if (candidate && !candidate.endsWith("googleapis.com")) {
      domains.add(candidate);
    }
  }

  return Array.from(domains);
}

function isLikelyAICandidate(
  appName: string,
  scopes: string[],
  domains: string[]
) {
  const combined = [appName, ...scopes, ...domains].join(" ").toLowerCase();
  const aiKeywords = [
    "ai",
    "gpt",
    "copilot",
    "claude",
    "gemini",
    "llm",
    "anthropic",
    "openai",
    "mistral",
    "perplexity",
    "cursor",
  ];

  if (domains.some((domain) => domain.endsWith(".ai"))) return true;
  return aiKeywords.some((keyword) => combined.includes(keyword));
}

function buildLowConfidenceCandidate(
  appName: string,
  domains: string[],
  scopes: string[]
): AIToolMatchResult {
  const normalizedName = appName.trim() || domains[0] || "Unclassified AI App";
  const domain = domains[0] ?? "unknown.ai";
  return {
    tool: {
      toolName: normalizedName,
      vendor: "Needs Review",
      domains: [domain],
      clientNamePatterns: [normalizedName.toLowerCase()],
    },
    confidence: "low",
    score: 3,
    reasons: [
      `heuristic AI signal from ${domains.some((item) => item.endsWith(".ai")) ? ".ai domain" : "app/scopes keywords"}`,
      scopes.length > 0 ? "OAuth scopes present" : "raw app name only",
    ],
  };
}

function confidenceRank(value: MatchConfidence) {
  return value === "high" ? 3 : value === "medium" ? 2 : 1;
}

function buildGoogleDiscoveryNotes(input: {
  confidence: MatchConfidence;
  reasons: string[];
  firstSeen: string;
  lastSeen: string;
  eventCount: number;
  activeDays: number;
  lowConfidenceCandidate: boolean;
}) {
  return [
    input.lowConfidenceCandidate
      ? "Low-confidence Google OAuth candidate."
      : `Matched with ${input.confidence} confidence.`,
    `Signals: ${input.reasons.join(", ")}.`,
    `Observed ${input.eventCount} token event(s) across ${input.activeDays} day(s).`,
    `First seen ${new Date(input.firstSeen).toLocaleDateString()} · Last seen ${new Date(input.lastSeen).toLocaleDateString()}.`,
  ].join(" ");
}
