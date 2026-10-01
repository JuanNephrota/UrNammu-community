/**
 * Cheap ReDoS guards shared by the policy editor and the proxy runtime.
 * Mirrored byte-for-byte into ai-proxy/src/lib/regex-safety.ts (the Azure
 * Functions project cannot import from the app); scripts/check-mirror-drift.mjs
 * enforces that.
 *
 * Catastrophic backtracking is undecidable in general, so this rejects the
 * cheapest footguns and bounds the work: a pattern must pass the shape check,
 * and only the first MAX_PROMPT_SCAN_CHARS of a prompt are ever tested.
 */

export const MAX_PATTERN_LEN = 500;
export const MAX_PROMPT_SCAN_CHARS = 20_000;

// A quantifier applied directly to a group that itself contains a greedy
// quantifier: (.*)+, (a+)+, (\w*)+, (a|a)+
export const REDOS_SHAPES: RegExp[] = [
  /\([^)]*[+*][^)]*\)[+*]/,
  /\((?:\.\*|\.\+|\\w\*|\\w\+|\\s\*|\\s\+)\)[+*]/,
  /\(([^|)]+)\|\1\)/,
];

/** True when a stored pattern is short enough, has no nested-quantifier shape, and compiles. */
export function isSafeRuntimePattern(source: string): boolean {
  const trimmed = source.trim();
  if (!trimmed || trimmed.length > MAX_PATTERN_LEN) return false;
  if (REDOS_SHAPES.some((shape) => shape.test(trimmed))) return false;
  try {
    new RegExp(trimmed, "i");
    return true;
  } catch {
    return false;
  }
}
