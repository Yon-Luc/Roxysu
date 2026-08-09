type Bucket = {
  /** Timestamps of recent hits (ms). */
  hits: number[];
};

const buckets = new Map<string, Bucket>();

/**
 * Fixed-window-ish sliding rate limiter (in-memory, single process).
 * Returns true if the request is allowed.
 */
export function allowRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): boolean {
  const now = Date.now();
  const windowStart = now - opts.windowMs;
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }
  bucket.hits = bucket.hits.filter((t) => t > windowStart);
  if (bucket.hits.length >= opts.limit) return false;
  bucket.hits.push(now);

  // Opportunistic prune of idle keys
  if (buckets.size > 10_000) {
    for (const [k, b] of buckets) {
      b.hits = b.hits.filter((t) => t > windowStart);
      if (b.hits.length === 0) buckets.delete(k);
    }
  }
  return true;
}

export function clearRateLimitBuckets(): void {
  buckets.clear();
}
