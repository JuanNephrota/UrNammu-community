import { prisma } from "./prisma";
import { blockedDomains } from "./shadow-blocklist";
import type { NetworkRule } from "./network-rules";

/**
 * Rule set the Vercel network proxy evaluates: every enabled
 * `NetworkBlockRule` plus the domains of Shadow AI discoveries marked
 * BLOCKED. Cached per instance for a short TTL; a DB error serves the last
 * known set when there is one and otherwise propagates so the caller can
 * fail closed in enforce mode.
 */
export type NetworkRuleSet = {
  rules: NetworkRule[];
  shadowDomains: string[];
  loadedAt: number;
};

const TTL_MS = 30_000;
let cache: NetworkRuleSet | null = null;
let inflight: Promise<NetworkRuleSet> | null = null;

export async function loadNetworkRuleSet(opts: { fresh?: boolean } = {}): Promise<NetworkRuleSet> {
  const now = Date.now();
  if (!opts.fresh) {
    if (cache && now - cache.loadedAt < TTL_MS) return cache;
    if (inflight) return inflight;
  }
  const load = (async () => {
    try {
      // Sequential on purpose: the dev server shares one pooled connection.
      const rules = await prisma.networkBlockRule.findMany({
        where: { enabled: true },
        orderBy: { createdAt: "asc" },
        select: { id: true, pattern: true, action: true, enabled: true, reason: true },
      });
      const shadow = await blockedDomains();
      cache = { rules, shadowDomains: shadow.map((e) => e.domain), loadedAt: Date.now() };
      return cache;
    } catch (err) {
      if (cache) {
        console.error("loadNetworkRuleSet: DB error, serving stale rule set:", err);
        return cache;
      }
      throw err;
    } finally {
      inflight = null;
    }
  })();
  if (!opts.fresh) inflight = load;
  return load;
}

export function __clearNetworkRuleCache() {
  cache = null;
  inflight = null;
}
