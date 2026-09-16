/**
 * Pure helpers for hash-based dangerous_prompt alert dedupe. Kept free of
 * Prisma so they can be unit-tested; `createPromptRiskAlert` in
 * ./prompt-risk.ts does the IO.
 *
 * A dangerous_prompt alert's `promptRiskMetadata` carries, alongside the
 * per-rule detail:
 *   promptHash   — HMAC fingerprint of the normalized prompt (see prompt-hash.ts)
 *   occurrences  — how many times the same prompt was seen while the alert was OPEN
 *   surfaces     — where it was seen (deduped)
 *   actors       — who sent it (deduped user emails)
 *   lastSeenAt   — ISO timestamp of the most recent occurrence
 */

export const PROMPT_RISK_SURFACES = ["proxy", "claude_code", "cursor", "azure_proxy"] as const;
export type PromptRiskSurface = (typeof PROMPT_RISK_SURFACES)[number];

/** Window in which a repeat of the same prompt folds into the open alert. */
export const PROMPT_HASH_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Map the `provider` label each caller passes to createPromptRiskAlert onto a
 * surface. The Vercel proxies pass "claude" / "chatgpt"; the OTel ingest
 * routes pass "claude_code" / "cursor". Anything unrecognized is the proxy.
 */
export function surfaceForProvider(provider: string): PromptRiskSurface {
  if (provider === "claude_code") return "claude_code";
  if (provider === "cursor") return "cursor";
  if (provider === "azure_proxy") return "azure_proxy";
  return "proxy";
}

export type OccurrenceInput = {
  surface: PromptRiskSurface;
  userEmail: string | null | undefined;
  /** Injected for deterministic tests; defaults to now. */
  now?: Date;
};

export type OccurrenceMetadata = {
  occurrences: number;
  surfaces: string[];
  actors: string[];
  lastSeenAt: string;
};

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Occurrence fields for a brand-new alert (first sighting). */
export function initialOccurrenceMetadata(input: OccurrenceInput): OccurrenceMetadata {
  return {
    occurrences: 1,
    surfaces: [input.surface],
    actors: input.userEmail ? [input.userEmail] : [],
    lastSeenAt: (input.now ?? new Date()).toISOString(),
  };
}

/**
 * Fold one more sighting of the same prompt into an existing alert's
 * metadata. Returns a NEW metadata object: every existing key is preserved
 * (rule matches, excerpt, hash, ...), `occurrences` is incremented, and the
 * surface / actor are appended without duplicates. Tolerates legacy metadata
 * written before these fields existed (treated as one prior occurrence).
 */
export function mergePromptHashOccurrence(
  existing: unknown,
  input: OccurrenceInput
): Record<string, unknown> & OccurrenceMetadata {
  const base: Record<string, unknown> =
    typeof existing === "object" && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  const prior =
    typeof base.occurrences === "number" && Number.isFinite(base.occurrences) && base.occurrences > 0
      ? Math.floor(base.occurrences)
      : 1;

  return {
    ...base,
    occurrences: prior + 1,
    surfaces: dedupe([...stringArray(base.surfaces), input.surface]),
    actors: dedupe([...stringArray(base.actors), ...(input.userEmail ? [input.userEmail] : [])]),
    lastSeenAt: (input.now ?? new Date()).toISOString(),
  };
}
