/** True when Hub should fail closed (JWT, CORS). */
export function isHubProduction(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const node = (env.NODE_ENV ?? "").toLowerCase();
  const hub = (env.HUB_ENV ?? "").toLowerCase();
  return node === "production" || hub === "production";
}

export type CorsOrigin = string | string[];

/**
 * CORS allowlist. Dev defaults to `*`. Production requires an explicit
 * origin list — `*` and unset are rejected.
 */
export function resolveCorsOrigin(
  raw: string | undefined = process.env.CORS_ORIGIN,
  env: NodeJS.ProcessEnv = process.env,
): CorsOrigin {
  const parts = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (isHubProduction(env)) {
    if (parts.length === 0 || parts.includes("*")) {
      throw new Error(
        "[hub] CORS_ORIGIN must be an explicit origin list in production (not *).",
      );
    }
    return parts.length === 1 ? parts[0]! : parts;
  }

  if (parts.length === 0) return "*";
  if (parts.length === 1) return parts[0]!;
  return parts;
}

function envFlagEnabled(
  raw: string | undefined,
  defaultOn: boolean,
): boolean {
  if (raw == null || raw.trim() === "") return defaultOn;
  const v = raw.trim().toLowerCase();
  if (["0", "false", "off", "no"].includes(v)) return false;
  if (["1", "true", "on", "yes"].includes(v)) return true;
  return defaultOn;
}

/**
 * When false, GET /search always returns a miss (Download Maps → live mirror).
 * Primes remain in the Hub store for admin refresh.
 */
export function isHubSearchIndexEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envFlagEnabled(env.HUB_SEARCH_INDEX, true);
}

/**
 * When false, GET /search always sends Cache-Control / CDN-Cache-Control
 * no-store (stops new Cloudflare edge population).
 */
export function isHubSearchHttpCacheEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envFlagEnabled(env.HUB_SEARCH_HTTP_CACHE, true);
}

/** App-level freshness for hit-stale / background refresh (default 24h). */
export function hubCacheTtlMs(env: NodeJS.ProcessEnv = process.env): number {
  const n = parseInt(env.HUB_CACHE_TTL_MS ?? "86400000", 10);
  return Number.isFinite(n) && n > 0 ? n : 86_400_000;
}

/**
 * Cap for Cloudflare edge TTL derived from refresh_interval / HUB_CACHE_TTL.
 * Default 1h until edge caching is trusted in prod.
 */
export function hubSearchEdgeCacheMaxAgeSec(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const n = parseInt(env.HUB_SEARCH_EDGE_CACHE_MAX_AGE_SEC ?? "3600", 10);
  return Number.isFinite(n) && n > 0 ? n : 3600;
}
