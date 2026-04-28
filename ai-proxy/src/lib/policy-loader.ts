/**
 * Policy state loader for the Azure Functions proxy.
 *
 * Reads the global `policy_enforcement_mode` AppSetting + the active policies
 * assigned to a given AI system. Cached in memory for a short TTL so every
 * proxied request doesn't re-run two queries.
 *
 * Cache is per-function-instance (Azure spawns many) — some stale reads across
 * instances are acceptable because the enforcement mode is admin-toggled rarely
 * and policies change on human timescales.
 */

import { prisma } from "./db";
import type { PolicyRuntimeRules } from "./policy-enforcement";
import { parseRuntimeRules } from "./policy-enforcement";

export type EnforcementMode = "off" | "dryrun" | "enforce";

type CacheEntry<T> = { value: T; expiresAt: number };

const MODE_TTL_MS = 30_000;
const POLICIES_TTL_MS = 30_000;

let modeCache: CacheEntry<EnforcementMode> | null = null;
const policiesCache = new Map<string, CacheEntry<LoadedPolicy[]>>();

export type LoadedPolicy = {
  policyId: string;
  policyName: string;
  enforcement: "BLOCK" | "ADVISORY";
  runtime: PolicyRuntimeRules;
};

export async function loadEnforcementMode(): Promise<EnforcementMode> {
  const now = Date.now();
  if (modeCache && modeCache.expiresAt > now) return modeCache.value;

  const row = await prisma.appSetting
    .findUnique({ where: { key: "policy_enforcement_mode" } })
    .catch(() => null);

  const value =
    row?.value === "dryrun" || row?.value === "enforce"
      ? (row.value as EnforcementMode)
      : "off";

  modeCache = { value, expiresAt: now + MODE_TTL_MS };
  return value;
}

/**
 * Active policies attached to a system. Returns [] if the system is unknown
 * or has no ACTIVE policies with runtime rules. Only surfaces policies that
 * have at least one runtime rule — policies without any `runtime:` block
 * have nothing to say at the request path.
 */
export async function loadPoliciesForSystem(
  aiSystemId: string
): Promise<LoadedPolicy[]> {
  const now = Date.now();
  const cached = policiesCache.get(aiSystemId);
  if (cached && cached.expiresAt > now) return cached.value;

  const assignments = await prisma.policyAssignment
    .findMany({
      where: { aiSystemId },
      include: {
        policy: { select: { id: true, name: true, rules: true, status: true } },
      },
    })
    .catch(() => []);

  const loaded: LoadedPolicy[] = [];
  for (const assignment of assignments) {
    if (assignment.policy.status !== "ACTIVE") continue;
    const runtime = parseRuntimeRules(assignment.policy.rules);
    if (!runtime) continue;

    const actions = extractActions(assignment.policy.rules);
    loaded.push({
      policyId: assignment.policy.id,
      policyName: assignment.policy.name,
      enforcement: actions.enforcement,
      runtime,
    });
  }

  policiesCache.set(aiSystemId, {
    value: loaded,
    expiresAt: now + POLICIES_TTL_MS,
  });
  return loaded;
}

/** Clear all caches — used in tests and after settings writes (future). */
export function __clearPolicyLoaderCaches() {
  modeCache = null;
  policiesCache.clear();
}

function extractActions(rules: unknown): { enforcement: "BLOCK" | "ADVISORY" } {
  if (rules && typeof rules === "object" && !Array.isArray(rules)) {
    const actions = (rules as Record<string, unknown>).actions;
    if (actions && typeof actions === "object" && !Array.isArray(actions)) {
      const enforcement = (actions as Record<string, unknown>).enforcement;
      if (enforcement === "ADVISORY") return { enforcement: "ADVISORY" };
    }
  }
  // Default BLOCK matches the main app's evaluatePolicyRules default.
  return { enforcement: "BLOCK" };
}
