import { resolveAIToolMatch } from "./ai-tools-registry";
import { getSetting, HEXNODE_SETTINGS_KEYS } from "./settings";
import type { FullScanResult, ScanDiscovery } from "./google-workspace";

type HexnodeConfig = {
  apiKey: string;
  subdomain: string;
};

/** A device record from `GET /api/v1/devices/`. Field names vary slightly
 *  across Hexnode plans, so optional fallbacks are tolerated. */
type HexnodeDevice = {
  id?: number | string;
  device_name?: string;
  name?: string;
  platform?: string;
  os_name?: string;
  os_version?: string;
  user_name?: string;
  user?: { name?: string; email?: string } | string;
  email?: string;
};

/** An installed-app record from `GET /api/v1/devices/<id>/apps/`. */
type HexnodeApp = {
  app_name?: string;
  name?: string;
  bundle_id?: string;
  bundle_identifier?: string;
  identifier?: string;
  package_name?: string;
  developer?: string;
  publisher?: string;
  version?: string;
};

type HexnodePage<T> = {
  results?: T[];
  // Hexnode paginates with an absolute `next` URL; null/absent on the last page.
  next?: string | null;
  count?: number;
};

// Bound the scan so a large fleet can't exhaust the serverless function budget.
// Mirrors the Microsoft scanner's per-run caps.
const MAX_DEVICES = 200;
const MAX_PAGES = 25;

function normalizeSubdomain(raw: string): string {
  // Accept a bare slug ("acme"), a full host ("acme.hexnodemdm.com"), or a URL.
  return raw
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.hexnodemdm\.com$/i, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

async function getHexnodeConfig(): Promise<HexnodeConfig | null> {
  const [apiKey, subdomain] = await Promise.all([
    getSetting(HEXNODE_SETTINGS_KEYS.API_KEY),
    getSetting(HEXNODE_SETTINGS_KEYS.SUBDOMAIN),
  ]);

  const resolvedKey = apiKey ?? process.env.HEXNODE_API_KEY ?? "";
  const resolvedSubdomain = normalizeSubdomain(
    subdomain ?? process.env.HEXNODE_SUBDOMAIN ?? ""
  );

  return resolvedKey && resolvedSubdomain
    ? { apiKey: resolvedKey, subdomain: resolvedSubdomain }
    : null;
}

export async function isHexnodeConfigured(): Promise<boolean> {
  return !!(await getHexnodeConfig());
}

function baseUrl(subdomain: string): string {
  return `https://${subdomain}.hexnodemdm.com/api/v1`;
}

/** Perform a single authenticated GET against the Hexnode REST API. */
export async function hexnodeGet<T>(
  config: HexnodeConfig,
  path: string
): Promise<T> {
  const url = path.startsWith("http")
    ? path
    : `${baseUrl(config.subdomain)}${path}`;

  const response = await fetch(url, {
    headers: {
      // Hexnode expects the raw API key in the Authorization header.
      Authorization: config.apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Hexnode request to ${path} failed with ${response.status}.${
        text ? ` ${text.slice(0, 200)}` : ""
      }`
    );
  }

  return (await response.json()) as T;
}

/** Follow Hexnode's `next` pagination until exhausted, the page cap, or the
 *  item limit is reached. */
async function hexnodeList<T>(
  config: HexnodeConfig,
  path: string,
  limit: number
): Promise<T[]> {
  const results: T[] = [];
  let nextPath: string | null = path;
  let pages = 0;

  while (nextPath && results.length < limit && pages < MAX_PAGES) {
    const page: HexnodePage<T> = await hexnodeGet<HexnodePage<T>>(
      config,
      nextPath
    );
    results.push(...(page.results ?? []));
    nextPath = page.next ?? null;
    pages += 1;
  }

  return results.slice(0, limit);
}

function appPublisher(app: HexnodeApp): string | null {
  return app.developer ?? app.publisher ?? null;
}

function appName(app: HexnodeApp): string {
  return app.app_name ?? app.name ?? "";
}

function appIds(app: HexnodeApp): string[] {
  return [
    app.bundle_id,
    app.bundle_identifier,
    app.identifier,
    app.package_name,
  ].filter((value): value is string => !!value);
}

function deviceLabel(device: HexnodeDevice): string {
  return (
    device.device_name ??
    device.name ??
    (typeof device.id !== "undefined" ? `device ${device.id}` : "unknown device")
  );
}

function deviceUser(device: HexnodeDevice): string | null {
  if (typeof device.user === "string") return device.user;
  return (
    device.user?.email ??
    device.user?.name ??
    device.user_name ??
    device.email ??
    null
  );
}

/**
 * Scan Hexnode-managed devices for installed AI applications.
 *
 * Enumerates devices, fetches each device's installed-app inventory, and
 * matches every app against the known-AI-tools registry by name, publisher,
 * and bundle/package identifier. Detections are aggregated per tool (deduped
 * by toolName::domain) with userCount reflecting the number of distinct
 * devices the tool was found on.
 */
export async function runHexnodeScan(): Promise<FullScanResult> {
  const config = await getHexnodeConfig();
  if (!config) {
    throw new Error(
      "Hexnode is not configured. Add an API key and account subdomain."
    );
  }

  const devices = await hexnodeList<HexnodeDevice>(
    config,
    "/devices/",
    MAX_DEVICES
  );

  // Aggregate detections keyed by toolName::domain across the whole fleet.
  const aggregate = new Map<
    string,
    ScanDiscovery & {
      deviceNames: Set<string>;
      users: Set<string>;
      platforms: Set<string>;
    }
  >();

  let appsScanned = 0;

  for (const device of devices) {
    if (typeof device.id === "undefined" || device.id === null) continue;

    let apps: HexnodeApp[];
    try {
      apps = await hexnodeList<HexnodeApp>(
        config,
        `/devices/${device.id}/apps/`,
        500
      );
    } catch {
      // Skip individual devices whose app inventory is unavailable (e.g. the
      // device is offline or app inventory collection is disabled for it).
      continue;
    }

    appsScanned += apps.length;
    const platform = device.platform ?? device.os_name ?? "Unknown";
    const label = deviceLabel(device);
    const user = deviceUser(device);

    for (const app of apps) {
      const name = appName(app);
      const ids = appIds(app);
      if (!name && ids.length === 0) continue;

      const match = resolveAIToolMatch({
        clientName: name,
        publisherName: appPublisher(app),
        appIds: ids,
      });
      if (!match) continue;

      // A publisher name alone (e.g. "Microsoft", "Google") is far too broad a
      // signal for device inventory — it would flag Word, Excel, Teams, etc. as
      // Copilot. Require a distinguishing signal: app name, bundle ID, or domain.
      const hasDistinguishingSignal = match.reasons.some(
        (reason) => !reason.startsWith("publisher matched")
      );
      if (!hasDistinguishingSignal) continue;

      const domain = match.tool.domains[0];
      const key = `${match.tool.toolName}::${domain}`;
      const existing = aggregate.get(key);

      if (existing) {
        existing.deviceNames.add(label);
        if (user) existing.users.add(user);
        existing.platforms.add(platform);
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
          userEmails: user ? [user] : [],
          userCount: 0,
          matchConfidence: match.confidence,
          matchScore: match.score,
          matchReasons: match.reasons,
          deviceNames: new Set([label]),
          users: new Set(user ? [user] : []),
          platforms: new Set([platform]),
        });
      }
    }
  }

  const discoveries: ScanDiscovery[] = Array.from(aggregate.values()).map(
    (entry) => {
      const deviceCount = entry.deviceNames.size;
      const userCount = Math.max(entry.users.size, deviceCount);
      const platforms = Array.from(entry.platforms).join(", ");
      return {
        toolName: entry.toolName,
        vendor: entry.vendor,
        domain: entry.domain,
        userEmails: Array.from(entry.users),
        userCount,
        matchConfidence: entry.matchConfidence,
        matchScore: entry.matchScore,
        matchReasons: entry.matchReasons,
        notes: `Installed on ${deviceCount} managed device(s)${
          platforms ? ` (${platforms})` : ""
        }. Matched with ${entry.matchConfidence} confidence via ${
          entry.matchReasons?.join(", ") ?? "device app inventory"
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
