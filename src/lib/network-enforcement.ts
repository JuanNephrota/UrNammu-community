/**
 * In-path enforcement of Shadow AI blocks by the general network proxy.
 *
 * The blocklist feed (shadow-blocklist.ts) and identity enforcement
 * (identity-enforcement.ts) act outside the traffic path. The network proxy
 * (`/api/proxy/net/…`, network-rules.ts) is the one layer UrNammu itself
 * sits in: every BLOCKED discovery's domain is denied there automatically,
 * so blocking a tool needs no extra call — this module only reports what
 * that block will do given the current `network_proxy_mode`, and reads back
 * how often the proxy has actually hit it.
 */
import { prisma } from "./prisma";
import { getSetting } from "./settings";
import { parseNetworkProxyMode, type NetworkProxyMode } from "./network-rules";
import { normalizeDomain } from "./shadow-blocklist";
import { __clearNetworkRuleCache } from "./network-rules-loader";

export type ProxyEnforcementAction =
  | "blocked" // enforce mode: requests to the domain now get 403
  | "monitored" // monitor mode: requests are logged as would-block, still forwarded
  | "off" // proxy disabled: nothing is enforced in-path
  | "skipped" // no domain captured — nothing for the proxy to match
  | "unblocked"; // domain removed from the in-path denylist

export type ProxyEnforcementResult = {
  enforced: boolean;
  mode: NetworkProxyMode;
  domain: string | null;
  action: ProxyEnforcementAction;
  message: string;
};

/** Pure: what blocking/unblocking a tool means at the proxy in the given mode. */
export function proxyEnforcementOutcome(
  tool: { toolName: string; detectedDomain: string | null },
  mode: NetworkProxyMode,
  block: boolean
): ProxyEnforcementResult {
  const domain = normalizeDomain(tool.detectedDomain);
  if (!domain) {
    return {
      enforced: false,
      mode,
      domain: null,
      action: "skipped",
      message: `No domain was captured for "${tool.toolName}", so the network proxy has nothing to match.`,
    };
  }
  if (!block) {
    return {
      enforced: mode === "enforce",
      mode,
      domain,
      action: "unblocked",
      message:
        mode === "off"
          ? `"${domain}" is no longer on the in-path denylist (the network proxy is off).`
          : `"${domain}" is no longer denied by the network proxy; traffic flows again within 30 seconds.`,
    };
  }
  switch (mode) {
    case "enforce":
      return {
        enforced: true,
        mode,
        domain,
        action: "blocked",
        message: `Network proxy: requests to ${domain} and its subdomains now get 403 (within 30 seconds).`,
      };
    case "monitor":
      return {
        enforced: false,
        mode,
        domain,
        action: "monitored",
        message: `Network proxy is in Monitor mode: requests to ${domain} are logged as would-block but still forwarded. Switch to Enforce in Settings → Proxy Setup to deny them.`,
      };
    default:
      return {
        enforced: false,
        mode,
        domain,
        action: "off",
        message: `Network proxy is off, so ${domain} is not denied in-path. Turn it on in Settings → Proxy Setup to enforce this block for proxied traffic.`,
      };
  }
}

/**
 * Report what a block/unblock does at the proxy, and drop this instance's
 * cached rule set so the Vercel route sees the change at once (the Azure
 * proxy re-reads within its 30 s TTL).
 */
export async function describeProxyEnforcement(
  tool: { toolName: string; detectedDomain: string | null },
  block: boolean
): Promise<ProxyEnforcementResult> {
  const mode = parseNetworkProxyMode(
    (await getSetting("network_proxy_mode").catch(() => null)) ?? process.env.NETWORK_PROXY_MODE
  );
  __clearNetworkRuleCache();
  return proxyEnforcementOutcome(tool, mode, block);
}

export type ProxyBlockStats = {
  /** Requests the proxy refused for this domain (enforce) in the window. */
  blocked: number;
  /** Requests that would have been refused (monitor) in the window. */
  monitored: number;
  lastAt: string | null;
};

export const PROXY_BLOCK_STATS_WINDOW_DAYS = 30;

/**
 * How often the proxy has matched each Shadow AI domain recently, keyed by
 * normalized domain. Reads the request log rows the proxies write with
 * `ruleSource = "shadow_ai"` (`rulePattern` is the normalized domain).
 */
export async function proxyBlockStats(domains: string[]): Promise<Map<string, ProxyBlockStats>> {
  const out = new Map<string, ProxyBlockStats>();
  const keys = [...new Set(domains.map((d) => normalizeDomain(d)).filter((d): d is string => !!d))];
  if (keys.length === 0) return out;
  const since = new Date(Date.now() - PROXY_BLOCK_STATS_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.networkRequestLog.groupBy({
    by: ["rulePattern", "action"],
    where: { ruleSource: "shadow_ai", rulePattern: { in: keys }, createdAt: { gte: since } },
    _count: { _all: true },
    _max: { createdAt: true },
  });
  for (const row of rows) {
    if (!row.rulePattern) continue;
    const stats = out.get(row.rulePattern) ?? { blocked: 0, monitored: 0, lastAt: null };
    if (row.action === "blocked") stats.blocked += row._count._all;
    else if (row.action === "monitored") stats.monitored += row._count._all;
    const at = row._max.createdAt?.toISOString() ?? null;
    if (at && (!stats.lastAt || at > stats.lastAt)) stats.lastAt = at;
    out.set(row.rulePattern, stats);
  }
  return out;
}
