/** True when Hub should fail closed (JWT, CORS). */
export function isHubProduction(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const node = (env.NODE_ENV ?? "").toLowerCase();
  const hub = (env.HUB_ENV ?? "").toLowerCase();
  return node === "production" || hub === "production";
}

/** Roxysu client origins (`ROXYSU_PORT` default 4321). Default non-production CORS allowlist. */
export const HUB_DEFAULT_CLIENT_ORIGINS = [
  "http://127.0.0.1:4321",
  "http://localhost:4321",
] as const;

/** True for `localhost`, `127.0.0.0/8`, and `::1` (bracketed or not). */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (h === "localhost" || h === "::1") return true;
  return /^127(?:\.\d{1,3}){3}$/.test(h);
}

/**
 * Hub listen host. Unset means the runtime default; any value other than a
 * loopback host publishes the port and is treated like production for CORS.
 */
export function resolveHubListenHost(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.HUB_LISTEN?.trim();
  return raw ? raw : undefined;
}

/** True when CORS must be an explicit list: production, or a non-loopback `HUB_LISTEN`. */
export function isHubPublished(env: NodeJS.ProcessEnv = process.env): boolean {
  if (isHubProduction(env)) return true;
  const host = resolveHubListenHost(env);
  return host != null && !isLoopbackHost(host);
}

export type CorsOrigin = string | string[];

/**
 * CORS allowlist. Production and a published port (`HUB_LISTEN` not loopback)
 * require an explicit origin list; `*` and unset are rejected. Otherwise an
 * unset `CORS_ORIGIN` defaults to the Roxysu client's loopback origins.
 * An explicit `*` is honoured only on a non-published Hub, with a warning.
 */
export function resolveCorsOrigin(
  raw: string | undefined = process.env.CORS_ORIGIN,
  env: NodeJS.ProcessEnv = process.env,
): CorsOrigin {
  const parts = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (isHubPublished(env)) {
    if (parts.length === 0 || parts.includes("*")) {
      throw new Error(
        isHubProduction(env)
          ? "[hub] CORS_ORIGIN must be an explicit origin list in production (not *)."
          : "[hub] CORS_ORIGIN must be an explicit origin list when HUB_LISTEN is not loopback (not *).",
      );
    }
    return parts.length === 1 ? parts[0]! : parts;
  }

  if (parts.length === 0) return [...HUB_DEFAULT_CLIENT_ORIGINS];
  if (parts.includes("*")) {
    console.warn(
      "[hub] CORS_ORIGIN=* answers every website; use only for throwaway local testing.",
    );
    return "*";
  }
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

/**
 * When false, GET /calc-bundles/* returns 503 (clients skip Hub fill).
 * Admin upload/list/delete remain available.
 */
export function isHubCalcBundlesEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return envFlagEnabled(env.HUB_CALC_BUNDLES, true);
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
