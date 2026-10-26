/**
 * Rule set the Azure network proxy evaluates: every enabled
 * `NetworkBlockRule` plus the domains of Shadow AI discoveries marked
 * BLOCKED. Cached per function instance for a short TTL, following the
 * fail-closed contract of policy-loader.ts: a DB error serves the last
 * known set when there is one and otherwise propagates so the handler can
 * refuse the request in enforce mode.
 */
import { prisma } from "./db";
import { normalizeShadowDomain, type NetworkRule } from "./network-rules";

export type NetworkRuleSet = {
  rules: NetworkRule[];
  shadowDomains: string[];
  loadedAt: number;
};

const TTL_MS = 30_000;
let cache: NetworkRuleSet | null = null;

export async function loadNetworkRuleSet(): Promise<NetworkRuleSet> {
  const now = Date.now();
  if (cache && now - cache.loadedAt < TTL_MS) return cache;
  try {
    const rules = await prisma.networkBlockRule.findMany({
      where: { enabled: true },
      orderBy: { id: "asc" },
      select: { id: true, pattern: true, action: true, enabled: true, reason: true },
    });
    const tools = await prisma.discoveredAITool.findMany({
      where: { status: "BLOCKED", detectedDomain: { not: null } },
      select: { detectedDomain: true },
    });
    const shadowDomains = [...new Set(tools.map((t) => normalizeShadowDomain(t.detectedDomain)).filter((d): d is string => !!d))];
    cache = { rules, shadowDomains, loadedAt: Date.now() };
    return cache;
  } catch (err) {
    if (cache) {
      console.error("loadNetworkRuleSet: DB error, serving stale rule set:", err);
      return cache;
    }
    throw err;
  }
}

export function __clearNetworkRuleCache() {
  cache = null;
}
