/**
 * Validation helpers for user-authored regex patterns used by the
 * tunable prompt-risk engine.
 *
 * We don't attempt perfect ReDoS detection — that's an undecidable problem
 * in general. Instead we reject the cheapest footguns (nested quantifiers
 * over overlapping subexpressions) and enforce length/count bounds. A
 * runtime match is then run against a short probe string with a timeout
 * as a last line of defense.
 */

export type RegexValidationResult =
  | { ok: true }
  | { ok: false; error: string };

const MAX_PATTERN_LEN = 500;

// Shapes that trip catastrophic backtracking most commonly: a quantifier
// applied directly to a group that itself contains a greedy quantifier.
// Examples we want to reject:  (.*)+, (a+)+, (\w*)+, (a|a)+
const REDOS_SHAPES: RegExp[] = [
  /\([^)]*[+*][^)]*\)[+*]/,   // (X*)+ or (X+)* or (X+)+
  /\((?:\.\*|\.\+|\\w\*|\\w\+|\\s\*|\\s\+)\)[+*]/, // (.*)+, (\w*)+, etc.
  /\(([^|)]+)\|\1\)/,          // (a|a) — trivial alternation
];

/**
 * Validate a single regex source string. Returns `{ ok: true }` or a
 * structured error.
 */
export function validateRegexPattern(source: string): RegexValidationResult {
  if (typeof source !== "string") {
    return { ok: false, error: "Pattern must be a string." };
  }
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Pattern cannot be empty." };
  }
  if (trimmed.length > MAX_PATTERN_LEN) {
    return {
      ok: false,
      error: `Pattern is too long (max ${MAX_PATTERN_LEN} characters).`,
    };
  }

  for (const shape of REDOS_SHAPES) {
    if (shape.test(trimmed)) {
      return {
        ok: false,
        error:
          "Pattern contains a nested-quantifier shape that can cause catastrophic backtracking. " +
          "Rewrite without a greedy quantifier inside another quantified group.",
      };
    }
  }

  let compiled: RegExp;
  try {
    compiled = new RegExp(trimmed, "i");
  } catch (err) {
    return {
      ok: false,
      error: `Pattern does not compile as a regex: ${(err as Error).message}`,
    };
  }

  // Last-ditch runtime probe with a timeout. If a pattern explodes on
  // a benign 1 KB input, reject it.
  const probe = "a".repeat(256) + " the quick brown fox " + "b".repeat(256);
  const start = Date.now();
  try {
    compiled.exec(probe);
  } catch {
    // Ignore — exec can't really throw, but defensive.
  }
  const elapsed = Date.now() - start;
  if (elapsed > 50) {
    return {
      ok: false,
      error: `Pattern took ${elapsed}ms on a short probe string — likely catastrophic backtracking.`,
    };
  }

  return { ok: true };
}

/**
 * Validate an array of patterns for a single rule.
 */
export function validateRegexPatterns(
  patterns: string[]
): RegexValidationResult {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return { ok: false, error: "At least one pattern is required." };
  }
  if (patterns.length > 10) {
    return { ok: false, error: "Max 10 patterns per rule." };
  }
  for (let i = 0; i < patterns.length; i++) {
    const result = validateRegexPattern(patterns[i]);
    if (!result.ok) {
      return { ok: false, error: `Pattern #${i + 1}: ${result.error}` };
    }
  }
  return { ok: true };
}

/**
 * Compile a pattern defensively, returning null on error (rather than
 * throwing). Used by the runtime loader so a single broken pattern
 * doesn't take down the whole scanner.
 */
export function safeCompileRegex(source: string): RegExp | null {
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}
