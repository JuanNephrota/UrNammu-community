/**
 * Governed-system attribution for provider-synced telemetry.
 *
 * Two settings drive how admin-sync'd `UsageBucket` / `CostBucket` rows get
 * an `aiSystemId`:
 *
 *  - `<provider>_managed_system_id` — a provider-wide default. Every row the
 *    provider sync writes is attributed to this registered AI system unless a
 *    more specific key mapping applies.
 *  - `provider_key_system_map` — JSON `{ [provider]: { [apiKeyExternalId]: aiSystemId } }`.
 *    Maps an individual provider API key (Anthropic `api_key_id`, OpenAI
 *    `api_key_id`, LiteLLM key hash) to a registered AI system. Wins over the
 *    provider default when the key is present.
 *
 * Both are applied identically to usage and cost rows so cost-by-system on
 * Oversight reconciles with tokens-by-system.
 *
 * This module is pure (no Prisma / no settings I/O) so it can be unit-tested;
 * `provider-telemetry.ts` loads the settings and validates the referenced
 * systems exist before calling `buildSystemResolver`.
 */

export type ProviderKeySystemMap = Record<string, Record<string, string>>;

export const KEY_MAPPABLE_PROVIDERS = ["anthropic", "openai", "litellm"] as const;
export type KeyMappableProvider = (typeof KEY_MAPPABLE_PROVIDERS)[number];

/**
 * Parse the raw `provider_key_system_map` setting. Tolerates null / malformed
 * JSON (returns an empty map) and drops entries whose provider, key, or
 * system id is not a non-empty string so one bad row cannot break the sync.
 */
export function parseProviderKeySystemMap(raw: string | null | undefined): ProviderKeySystemMap {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const out: ProviderKeySystemMap = {};
  for (const [provider, keys] of Object.entries(parsed as Record<string, unknown>)) {
    if (!provider || !keys || typeof keys !== "object" || Array.isArray(keys)) continue;
    const cleaned: Record<string, string> = {};
    for (const [apiKeyId, systemId] of Object.entries(keys as Record<string, unknown>)) {
      if (apiKeyId && typeof systemId === "string" && systemId.length > 0) {
        cleaned[apiKeyId] = systemId;
      }
    }
    if (Object.keys(cleaned).length > 0) out[provider] = cleaned;
  }
  return out;
}

export function serializeProviderKeySystemMap(map: ProviderKeySystemMap): string | null {
  const cleaned = parseProviderKeySystemMap(JSON.stringify(map));
  return Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned) : null;
}

/** Every AI system id referenced by the map or the default, deduplicated. */
export function collectReferencedSystemIds(
  map: ProviderKeySystemMap,
  defaults: (string | null | undefined)[] = []
): string[] {
  const ids = new Set<string>();
  for (const id of defaults) if (id) ids.add(id);
  for (const keys of Object.values(map)) {
    for (const id of Object.values(keys)) ids.add(id);
  }
  return [...ids];
}

export type SystemResolver = {
  /** Provider-wide default, or null when unset / points at a deleted system. */
  defaultSystemId: string | null;
  /** System for a given provider API key, falling back to the default. */
  forKey(apiKeyExternalId: string | null | undefined): string | null;
  /**
   * System for a group of keys (a workspace, a project). Returns the single
   * system all mapped keys agree on; if the keys disagree, or none of them is
   * mapped, falls back to the default. Used for cost rows that providers
   * report per workspace/project rather than per key.
   */
  forKeys(apiKeyExternalIds: Iterable<string | null | undefined>): string | null;
};

/**
 * Build a resolver for one provider.
 *
 * @param validSystemIds — ids of AI systems that exist. Mappings pointing at
 *   anything else are ignored (a deleted system must not break the FK).
 */
export function buildSystemResolver(args: {
  provider: string;
  defaultSystemId: string | null | undefined;
  keyMap: ProviderKeySystemMap;
  validSystemIds: Iterable<string>;
}): SystemResolver {
  const valid = new Set(args.validSystemIds);
  const defaultSystemId =
    args.defaultSystemId && valid.has(args.defaultSystemId) ? args.defaultSystemId : null;
  const keys = args.keyMap[args.provider] ?? {};

  const forKey = (apiKeyExternalId: string | null | undefined): string | null => {
    if (apiKeyExternalId) {
      const mapped = keys[apiKeyExternalId];
      if (mapped && valid.has(mapped)) return mapped;
    }
    return defaultSystemId;
  };

  const forKeys = (apiKeyExternalIds: Iterable<string | null | undefined>): string | null => {
    const systems = new Set<string>();
    for (const id of apiKeyExternalIds) {
      if (!id) continue;
      const mapped = keys[id];
      if (mapped && valid.has(mapped)) systems.add(mapped);
    }
    if (systems.size === 1) return [...systems][0];
    return defaultSystemId;
  };

  return { defaultSystemId, forKey, forKeys };
}
