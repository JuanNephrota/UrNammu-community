import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of a client-supplied secret against the expected
 * value. Plain `===` short-circuits on the first mismatched character, which
 * lets an attacker recover the secret byte-by-byte from response timing.
 *
 * Both sides are SHA-256 hashed before comparison so the buffers are always
 * the same length — `timingSafeEqual` throws on length mismatch, and an early
 * length check would itself leak the secret's length.
 *
 * Mirror of `ai-proxy/src/lib/secret-compare.ts` — kept in sync by convention.
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
