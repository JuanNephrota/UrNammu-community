import { resolveAIToolMatch } from "./ai-tools-registry";
import { getSetting, CROWDSTRIKE_SETTINGS_KEYS } from "./settings";
import type { FullScanResult, ScanDiscovery } from "./google-workspace";

type CrowdStrikeConfig = {
  clientId: string;
  clientSecret: string;
  // Falcon API cloud base URL, e.g. https://api.crowdstrike.com (US-1).
  baseUrl: string;
};

/** OAuth2 client-credentials token response from `POST /oauth2/token`. */
type CrowdStrikeToken = {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
};

/** An application record from Falcon Discover
 *  `GET /falcon-discover/combined/applications/v1`. Field availability varies
 *  by Falcon plan, so optional fallbacks are tolerated. */
type CrowdStrikeApplication = {
  id?: string;
  name?: string;
  vendor?: string;
  name_vendor?: string;
  version?: string;
  // Number of managed hosts the application is installed on. Different Falcon
  // plans surface this under different keys; we coalesce in appHostCount().
  assigned_host_count?: number;
  host_count?: number;
  installation_count?: number;
};

type CrowdStrikeQueryResponse = {
  resources?: CrowdStrikeApplication[];
  meta?: {
    pagination?: {
      offset?: number | string;
      limit?: number;
      total?: number;
    };
  };
  errors?: { code?: number; message?: string }[];
};

// Bound the scan so a large estate can't exhaust the serverless function
// budget. Mirrors the Hexnode scanner's per-run caps.
const MAX_PAGES = 25;
const PAGE_LIMIT = 100;

// Recognized Falcon API clouds. Stored as a bare URL so a custom/GovCloud host
// can still be entered manually, but these cover the standard regions.
export const CROWDSTRIKE_CLOUDS = [
  { value: "https://api.crowdstrike.com", label: "US-1 (api.crowdstrike.com)" },
  { value: "https://api.us-2.crowdstrike.com", label: "US-2 (api.us-2.crowdstrike.com)" },
  { value: "https://api.eu-1.crowdstrike.com", label: "EU-1 (api.eu-1.crowdstrike.com)" },
  {
    value: "https://api.laggar.gcw.crowdstrike.com",
    label: "US-GOV-1 (api.laggar.gcw.crowdstrike.com)",
  },
] as const;

export const CROWDSTRIKE_DEFAULT_CLOUD = CROWDSTRIKE_CLOUDS[0].value;

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function getCrowdStrikeConfig(): Promise<CrowdStrikeConfig | null> {
  const [clientId, clientSecret, baseUrl] = await Promise.all([
    getSetting(CROWDSTRIKE_SETTINGS_KEYS.CLIENT_ID),
    getSetting(CROWDSTRIKE_SETTINGS_KEYS.CLIENT_SECRET),
    getSetting(CROWDSTRIKE_SETTINGS_KEYS.BASE_URL),
  ]);

  const resolvedId = clientId ?? process.env.CROWDSTRIKE_CLIENT_ID ?? "";
  const resolvedSecret =
    clientSecret ?? process.env.CROWDSTRIKE_CLIENT_SECRET ?? "";
  const resolvedBaseUrl = normalizeBaseUrl(
    baseUrl ?? process.env.CROWDSTRIKE_BASE_URL ?? CROWDSTRIKE_DEFAULT_CLOUD
  );

  return resolvedId && resolvedSecret && resolvedBaseUrl
    ? {
        clientId: resolvedId,
        clientSecret: resolvedSecret,
        baseUrl: resolvedBaseUrl,
      }
    : null;
}

export async function isCrowdStrikeConfigured(): Promise<boolean> {
  return !!(await getCrowdStrikeConfig());
}

/**
 * Obtain a bearer token via the OAuth2 client-credentials flow. Tokens are
 * short-lived (~30 min); we fetch one per scan rather than caching since scans
 * are infrequent and run in stateless serverless invocations.
 */
export async function getCrowdStrikeToken(
  config: CrowdStrikeConfig
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `CrowdStrike token request failed with ${response.status}.${
        // 403 here almost always means the API client lacks the required
        // scopes; 401 means bad client_id/secret.
        text ? ` ${text.slice(0, 200)}` : ""
      }`
    );
  }

  const data = (await response.json()) as CrowdStrikeToken;
  if (!data.access_token) {
    throw new Error("CrowdStrike token response did not include an access_token.");
  }
  return data.access_token;
}

/** Perform a single authenticated GET against the Falcon API. */
export async function crowdstrikeGet<T>(
  config: CrowdStrikeConfig,
  token: string,
  path: string
): Promise<T> {
  const url = path.startsWith("http") ? path : `${config.baseUrl}${path}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `CrowdStrike request to ${path} failed with ${response.status}.${
        text ? ` ${text.slice(0, 200)}` : ""
      }`
    );
  }

  return (await response.json()) as T;
}

function appName(app: CrowdStrikeApplication): string {
  return app.name ?? "";
}

function appHostCount(app: CrowdStrikeApplication): number {
  return (
    app.assigned_host_count ??
    app.host_count ??
    app.installation_count ??
    0
  );
}

/**
 * Scan CrowdStrike Falcon-managed endpoints for installed AI applications.
 *
 * Uses the Falcon Discover combined-applications endpoint, which returns one
 * record per application with an aggregated managed-host count already
 * computed — so, unlike the Hexnode scanner, no per-device fan-out is needed.
 * Each application is matched against the known-AI-tools registry by name and
 * vendor; matches are deduped by toolName::domain with userCount reflecting the
 * number of managed hosts the tool is installed on.
 */
export async function runCrowdStrikeScan(): Promise<FullScanResult> {
  const config = await getCrowdStrikeConfig();
  if (!config) {
    throw new Error(
      "CrowdStrike is not configured. Add a client ID, secret, and API cloud."
    );
  }

  const token = await getCrowdStrikeToken(config);

  // Aggregate detections keyed by toolName::domain across the estate.
  const aggregate = new Map<
    string,
    ScanDiscovery & { hosts: number }
  >();

  let appsScanned = 0;
  let offset = 0;
  let pages = 0;

  while (pages < MAX_PAGES) {
    const page = await crowdstrikeGet<CrowdStrikeQueryResponse>(
      config,
      token,
      `/falcon-discover/combined/applications/v1?limit=${PAGE_LIMIT}&offset=${offset}`
    );

    const apps = page.resources ?? [];
    appsScanned += apps.length;

    for (const app of apps) {
      const name = appName(app);
      const vendor = app.vendor ?? null;
      if (!name) continue;

      const match = resolveAIToolMatch({
        clientName: name,
        publisherName: vendor,
        // Falcon's `name_vendor` is a stable composite identifier; pass it as a
        // weak app-id signal alongside the human-readable name.
        appIds: app.name_vendor ? [app.name_vendor] : [],
      });
      if (!match) continue;

      // A vendor name alone (e.g. "Microsoft", "Google") is far too broad a
      // signal for endpoint inventory — it would flag Office, Chrome, etc. as
      // Copilot/Gemini. Require a distinguishing signal: app name or app id.
      // Mirrors the same guard in the Hexnode scanner.
      const hasDistinguishingSignal = match.reasons.some(
        (reason) => !reason.startsWith("publisher matched")
      );
      if (!hasDistinguishingSignal) continue;

      const domain = match.tool.domains[0];
      const key = `${match.tool.toolName}::${domain}`;
      const hosts = appHostCount(app);
      const existing = aggregate.get(key);

      if (existing) {
        existing.hosts += hosts;
        // Keep the strongest match seen for this tool.
        if ((match.score ?? 0) > (existing.matchScore ?? 0)) {
          existing.matchConfidence = match.confidence;
          existing.matchScore = match.score;
          existing.matchReasons = match.reasons;
        }
      } else {
        aggregate.set(key, {
          toolName: match.tool.toolName,
          vendor: match.tool.vendor,
          domain,
          userEmails: [],
          userCount: 0,
          matchConfidence: match.confidence,
          matchScore: match.score,
          matchReasons: match.reasons,
          hosts,
        });
      }
    }

    pages += 1;

    // Advance pagination. Stop when a short page signals the last page.
    const total = page.meta?.pagination?.total;
    offset += apps.length;
    if (apps.length < PAGE_LIMIT) break;
    if (typeof total === "number" && offset >= total) break;
  }

  const discoveries: ScanDiscovery[] = Array.from(aggregate.values()).map(
    (entry) => {
      const hostCount = entry.hosts;
      return {
        toolName: entry.toolName,
        vendor: entry.vendor,
        domain: entry.domain,
        userEmails: [],
        // Host count is the closest available proxy for reach. At least 1 so a
        // detected-but-uncounted app still surfaces with a non-zero footprint.
        userCount: Math.max(hostCount, 1),
        matchConfidence: entry.matchConfidence,
        matchScore: entry.matchScore,
        matchReasons: entry.matchReasons,
        notes: `Detected on ${hostCount} managed endpoint(s) via CrowdStrike Falcon Discover. Matched with ${
          entry.matchConfidence
        } confidence via ${
          entry.matchReasons?.join(", ") ?? "endpoint application inventory"
        }.`,
      };
    }
  );

  return {
    discoveries,
    totalEventsScanned: appsScanned,
    aiToolsFound: discoveries.length,
  };
}
