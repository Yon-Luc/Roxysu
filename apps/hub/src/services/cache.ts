import { eq } from "drizzle-orm";
import { db } from "../db";
import { searchCache } from "../../../../packages/db/src/hub/schema";
import { fetchAllBeatmapsetIds, type HinamizawaSearchParams } from "./hinamizawa";

const TTL_MS = parseInt(process.env.HUB_CACHE_TTL_MS ?? "86400000", 10);

/**
 * Deterministic hash of query params:
 * - sort keys alphabetically
 * - lowercase string values
 * - skip undefined/empty
 * Returns a short hex string safe to use as a DB key.
 */
export function hashQueryParams(params: HinamizawaSearchParams): string {
  const normalized = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${String(v).toLowerCase()}`)
    .join("&");

  // FNV-1a 32-bit — tiny, no deps, deterministic
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    h ^= normalized.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
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

/**
 * Run the hinamizawa search for a cache entry and upsert the result.
 * Called by both POST /admin/cache (create) and POST /admin/cache/:id/refresh.
 */
export async function refreshCache(cacheId: number): Promise<void> {
  const entry = await db
    .select()
    .from(searchCache)
    .where(eq(searchCache.id, cacheId))
    .get();

  if (!entry) throw new Error(`Cache entry ${cacheId} not found`);

  const params = JSON.parse(entry.queryParams) as HinamizawaSearchParams;

  console.log(`[cache] Refreshing cache ${cacheId} (${entry.label || entry.queryHash})`);

  const result = await fetchAllBeatmapsetIds(params, (fetched, total) => {
    process.stdout.write(`\r[cache] ${fetched}/${total} beatmapsets fetched`);
  });
  console.log(); // newline after progress

  await db
    .update(searchCache)
    .set({
      beatmapsetIds: JSON.stringify(result.beatmapsetIds),
      totalCount: result.totalCount,
      cachedAt: new Date(),
    })
    .where(eq(searchCache.id, cacheId));

  console.log(`[cache] Done — ${result.beatmapsetIds.length} IDs stored`);
}

/**
 * Slice a cached beatmapset_ids JSON array for a paginated /search response.
 */
export function sliceIds(
  raw: string,
  page: number,
  limit: number
): { ids: number[]; total: number } {
  const all: number[] = JSON.parse(raw);
  const start = page * limit;
  return {
    ids: all.slice(start, start + limit),
    total: all.length,
  };
}
