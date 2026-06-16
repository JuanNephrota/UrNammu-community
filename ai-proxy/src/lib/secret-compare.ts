import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a client-supplied secret against the expected
 * value. Mirror of `src/lib/secret-compare.ts` in the main Nammu app — kept
 * in sync by convention. See that file for full rationale.
 */
export function secretsMatch(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!provided || !expected) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Constant-time match of an `Authorization: Bearer <token>` header. */
export function bearerTokenMatches(
  authHeader: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!authHeader?.startsWith("Bearer ")) return false;
  return secretsMatch(authHeader.slice(7), expected);
}
