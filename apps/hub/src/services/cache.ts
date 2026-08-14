import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { searchCache } from "@roxysu/db/hub";
import {
  fetchAllBeatmapsetIds,
  type HinamizawaSearchParams,
} from "./hinamizawa";

const TTL_MS = parseInt(process.env.HUB_CACHE_TTL_MS ?? "86400000", 10);
const KEY_FILTER_CONCURRENCY = 8;
const UA = "roxysu-hub/0.1 (+https://github.com/Yon-Luc/Roxysu)";
const INFO_TIMEOUT_MS = 12_000;

/** Roxysu-only cache identity fields — never forwarded to Hinamizawa. */
const ROXYSU_ONLY_KEYS = new Set(["key", "keys"]);

export type CacheQueryParams = HinamizawaSearchParams & {
  /** Mania keymode filter applied after fetching SetIDs. */
  key?: number;
  keys?: number;
};

/** 128-bit prefix of SHA-256; hex length of the Hub store query_hash key. */
export const QUERY_HASH_HEX_LENGTH = 32;

function paramsForHash(params: CacheQueryParams): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...params };
  if (copy.keys != null && (copy.key == null || copy.key === "")) {
    copy.key = Number(copy.keys);
  }
  delete copy.keys;
  return copy;
}

/**
 * Deterministic hash of query params:
 * - normalize keys → key
 * - sort keys alphabetically
 * - lowercase string values
 * - skip undefined/empty
 * SHA-256 truncated to 32 hex chars (128 bits).
 */
export function hashQueryParams(params: CacheQueryParams): string {
  const normalized = Object.entries(paramsForHash(params))
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v).toLowerCase()}`)
    .join("&");

  return createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, QUERY_HASH_HEX_LENGTH);
}

/**
 * Rewrite legacy FNV (or any other) query_hash values to the current SHA-256
 * identity so primed hub search index rows keep matching GET /search.
 */
export async function rehashSearchCacheKeys(): Promise<number> {
  const rows = await db
    .select({
      id: searchCache.id,
      queryHash: searchCache.queryHash,
      queryParams: searchCache.queryParams,
    })
    .from(searchCache);

  let updated = 0;
  for (const row of rows) {
    let params: CacheQueryParams;
    try {
      params = JSON.parse(row.queryParams) as CacheQueryParams;
    } catch {
      continue;
    }
    const next = hashQueryParams(params);
    if (next === row.queryHash) continue;
    const clash = await db
      .select({ id: searchCache.id })
      .from(searchCache)
      .where(eq(searchCache.queryHash, next))
      .get();
    if (clash && clash.id !== row.id) {
      console.warn(
        `[cache] skip rehash ${row.id}: new hash collides with ${clash.id}`,
      );
      continue;
    }
    await db
      .update(searchCache)
      .set({ queryHash: next })
      .where(eq(searchCache.id, row.id));
    updated += 1;
  }
  if (updated > 0) {
    console.log(`[cache] Rehashed ${updated} search_cache keys to SHA-256`);
  }
  return updated;
}

/** Params safe to send to Hinamizawa (no Roxysu-only key filter). */
export function stripRoxysuCacheParams(
  params: CacheQueryParams,
): HinamizawaSearchParams {
  const out: HinamizawaSearchParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (ROXYSU_ONLY_KEYS.has(k)) continue;
    if (v === undefined || v === null || v === "") continue;
    out[k] = v;
  }
  return out;
}

/** Exact mania keymode from cache params, if any. */
export function cacheKeymode(params: CacheQueryParams): number | null {
  const raw = params.key ?? params.keys;
  if (raw == null) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isSafeInteger(n) || n <= 0 || n > 18) return null;
  return n;
}

export type CacheStatus = "hit-fresh" | "hit-stale" | "miss";

export interface CacheLookupResult {
  status: CacheStatus;
  row: typeof searchCache.$inferSelect | null;
}

export async function lookupCache(queryHash: string): Promise<CacheLookupResult> {
  const row = await db
    .select()
    .from(searchCache)
    .where(eq(searchCache.queryHash, queryHash))
    .get();

  if (!row) return { status: "miss", row: null };

  const ageMs = Date.now() - new Date(row.cachedAt).getTime();
  const stale = ageMs > TTL_MS;

  return { status: stale ? "hit-stale" : "hit-fresh", row };
}

async function setHasKeymode(setId: number, keys: number): Promise<boolean> {
  try {
    const res = await fetch(
      `https://mirror.hinamizawa.ai/v3/osu/beatmaps/s/${setId}`,
      {
        headers: { accept: "application/json", "user-agent": UA },
        signal: AbortSignal.timeout(INFO_TIMEOUT_MS),
      },
    );
    if (!res.ok) return false;
    const payload = (await res.json()) as {
      beatmaps?: Array<Record<string, unknown>>;
    };
    const beatmaps = Array.isArray(payload.beatmaps) ? payload.beatmaps : [];
    for (const row of beatmaps) {
      const modeInt =
        typeof row.mode_int === "number"
          ? row.mode_int
          : Number(row.mode_int);
      const modeName =
        typeof row.mode === "string" ? row.mode.toLowerCase() : "";
      const isMania = modeInt === 3 || modeName === "mania";
      if (!isMania) continue;
      const cs =
        typeof row.cs === "number"
          ? row.cs
          : typeof row.cs === "string"
            ? Number(row.cs)
            : NaN;
      if (!Number.isFinite(cs)) continue;
      if (Math.round(cs) === keys) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Keep set IDs that have at least one mania diff with the given key count. */
export async function filterSetIdsByKeymode(
  setIds: number[],
  keys: number,
  onProgress?: (checked: number, total: number) => void,
): Promise<number[]> {
  const unique = [
    ...new Set(setIds.filter((id) => Number.isSafeInteger(id) && id > 0)),
  ];
  const kept: number[] = [];
  let checked = 0;
  let next = 0;

  async function worker() {
    while (next < unique.length) {
      const i = next;
      next += 1;
      const id = unique[i]!;
      if (await setHasKeymode(id, keys)) kept.push(id);
      checked += 1;
      onProgress?.(checked, unique.length);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(KEY_FILTER_CONCURRENCY, Math.max(1, unique.length)) },
      () => worker(),
    ),
  );

  // Preserve discovery order from the search crawl.
  const keptSet = new Set(kept);
  return unique.filter((id) => keptSet.has(id));
}

/**
 * Run the hinamizawa search for a cache entry and upsert the result.
 * Applies Roxysu keymode filter when `key`/`keys` is present in query_params.
 */
export async function refreshCache(cacheId: number): Promise<void> {
  const entry = await db
    .select()
    .from(searchCache)
    .where(eq(searchCache.id, cacheId))
    .get();

  if (!entry) throw new Error(`Cache entry ${cacheId} not found`);

  const params = JSON.parse(entry.queryParams) as CacheQueryParams;
  const hinaiParams = stripRoxysuCacheParams(params);
  const keymode = cacheKeymode(params);

  console.log(
    `[cache] Refreshing cache ${cacheId} (${entry.label || entry.queryHash})${
      keymode != null ? ` key=${keymode}` : ""
    }`,
  );

  const result = await fetchAllBeatmapsetIds(hinaiParams, (fetched, total) => {
    process.stdout.write(`\r[cache] ${fetched}/${total} beatmapsets fetched`);
  });
  console.log();

  let ids = result.beatmapsetIds;
  if (keymode != null) {
    ids = await filterSetIdsByKeymode(ids, keymode, (checked, total) => {
      process.stdout.write(`\r[cache] key filter ${checked}/${total}`);
    });
    console.log();
  }

  const now = new Date();
  await db
    .update(searchCache)
    .set({
      beatmapsetIds: JSON.stringify(ids),
      totalCount: ids.length,
      cachedAt: now,
      lastRefreshAt: now,
      refreshError: null,
      refreshBackoffUntil: null,
    })
    .where(eq(searchCache.id, cacheId));

  console.log(`[cache] Done — ${ids.length} IDs stored`);
}

/**
 * Slice a cached beatmapset_ids JSON array for a paginated /search response.
 */
export function sliceIds(
  raw: string,
  page: number,
  limit: number,
): { ids: number[]; total: number } {
  const all: number[] = JSON.parse(raw);
  const start = page * limit;
  return {
    ids: all.slice(start, start + limit),
    total: all.length,
  };
}

export function normalizeRefreshIntervalMinutes(
  value: number | null | undefined,
): number | null {
  if (value == null || value === 0) return null;
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}
