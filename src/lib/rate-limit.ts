/**
 * Best-effort fixed-window limiter keyed by caller (usually client IP).
 *
 * State lives in process memory, so on serverless each warm instance counts on
 * its own: this blunts a single host hammering an endpoint, it is not a global
 * quota. Put Vercel Firewall or a shared store in front if you need one.
 */

type Bucket = { count: number; resetAt: number };

const MAX_KEYS = 5_000;

export function createRateLimiter(limit: number, windowMs: number) {
  const buckets = new Map<string, Bucket>();

  return function allow(key: string, now = Date.now()): boolean {
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (buckets.size >= MAX_KEYS) {
        for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
        if (buckets.size >= MAX_KEYS) buckets.clear();
      }
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= limit;
  };
}

/** First hop of x-forwarded-for (set by the platform edge), else a shared bucket. */
export function clientKey(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
