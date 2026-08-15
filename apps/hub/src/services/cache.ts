import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { searchCache } from "@roxysu/db/hub";
import {
  fetchAllBeatmapsetStubs,
  type HinamizawaSearchParams,
  type SearchV2Difficulty,
  type SearchV2Set,
} from "./hinamizawa";
import {
  hubCacheTtlMs,
  hubSearchEdgeCacheMaxAgeSec,
} from "./hubEnv";

const KEY_FILTER_CONCURRENCY = 8;
const UA = "roxysu-hub/0.1 (+https://github.com/Yon-Luc/Roxysu)";
const INFO_TIMEOUT_MS = 12_000;

/** Roxysu-only cache identity fields — never forwarded to Hinamizawa. */
const ROXYSU_ONLY_KEYS = new Set(["key", "keys"]);

/** Base prime identity — hashed for hub search index rows. */
const BASE_PARAM_KEYS = new Set(["mode", "status", "key", "keys", "sort"]);

/** Applied at request time against enriched stubs (not part of row identity). */
const SECONDARY_PARAM_KEYS = new Set([
  "query",
  "min_stars",
  "max_stars",
  "min_bpm",
  "max_bpm",
  "min_length",
  "max_length",
  "creator",
]);

export type CacheQueryParams = HinamizawaSearchParams & {
  /** Mania keymode filter applied after fetching SetIDs. */
  key?: number;
  keys?: number;
};

/** Secondary filters from GET /search (not part of base hash). */
export type SearchSecondaryFilters = {
  query?: string;
  min_stars?: number;
  max_stars?: number;
  min_bpm?: number;
  max_bpm?: number;
  min_length?: number;
  max_length?: number;
  creator?: string;
};

/**
 * Compact stub persisted in `search_cache.beatmapset_ids` JSON.
 * Legacy rows may still be bare `number` ids (dual-read).
 */
export type HubSearchStub = {
  id: number;
  artist: string;
  title: string;
  creator: string;
  status: string;
  bpm: number | null;
  favouriteCount: number;
  playCount: number;
  hasVideo: boolean;
  rankedDate: string | null;
  lengthSeconds: number | null;
  beatmaps: Array<{
    id: number;
    version: string;
    stars: number;
    mode: string;
    modeInt: number;
    keys: number | null;
    totalLength: number | null;
  }>;
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

/** Keep only base identity fields for hashing / storage. */
export function baseParamsFromCacheQuery(
  params: CacheQueryParams,
): CacheQueryParams {
  const normalized = paramsForHash(params);
  const out: CacheQueryParams = {};
  for (const [k, v] of Object.entries(normalized)) {
    if (!BASE_PARAM_KEYS.has(k)) continue;
    if (v === undefined || v === null || v === "") continue;
    out[k] = v as string | number;
  }
  return out;
}

/** Secondary filters from a full GET /search param bag. */
export function secondaryFiltersFromQuery(
  params: CacheQueryParams,
): SearchSecondaryFilters {
  const out: SearchSecondaryFilters = {};
  for (const [k, v] of Object.entries(params)) {
    if (!SECONDARY_PARAM_KEYS.has(k)) continue;
    if (v === undefined || v === null || v === "") continue;
    if (
      k === "min_stars" ||
      k === "max_stars" ||
      k === "min_bpm" ||
      k === "max_bpm" ||
      k === "min_length" ||
      k === "max_length"
    ) {
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) out[k] = n;
    } else if (k === "query" || k === "creator") {
      out[k] = String(v);
    }
  }
  return out;
}

/**
 * Deterministic hash of **base** query params (mode, status, key, sort):
 * - normalize keys → key
 * - drop secondary filters (stars, bpm, query, …)
 * - sort keys alphabetically
 * - lowercase string values
 * - skip undefined/empty
 * SHA-256 truncated to 32 hex chars (128 bits).
 */
export function hashQueryParams(params: CacheQueryParams): string {
  const normalized = Object.entries(baseParamsFromCacheQuery(params))
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
 * Rewrite query_hash to base-only SHA-256 and strip secondary filters from
 * stored query_params so primed rows keep matching GET /search.
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
    const base = baseParamsFromCacheQuery(params);
    const next = hashQueryParams(base);
    const nextParamsJson = JSON.stringify(base);
    const hashChanged = next !== row.queryHash;
    const paramsChanged = nextParamsJson !== row.queryParams;
    if (!hashChanged && !paramsChanged) continue;

    if (hashChanged) {
      const clash = await db
        .select({ id: searchCache.id })
        .from(searchCache)
        .where(eq(searchCache.queryHash, next))
        .get();
      if (clash && clash.id !== row.id) {
        console.warn(
          `[cache] skip rehash ${row.id}: base hash collides with ${clash.id} (delete the narrower prime)`,
        );
        continue;
      }
    }

    await db
      .update(searchCache)
      .set({
        ...(hashChanged ? { queryHash: next } : {}),
        ...(paramsChanged ? { queryParams: nextParamsJson } : {}),
      })
      .where(eq(searchCache.id, row.id));
    updated += 1;
  }
  if (updated > 0) {
    console.log(
      `[cache] Rehashed / normalized ${updated} search_cache rows to base identity`,
    );
  }
  return updated;
}

/** Params safe to send to Hinamizawa for a base prime (no Roxysu-only key, no secondary). */
export function stripRoxysuCacheParams(
  params: CacheQueryParams,
): HinamizawaSearchParams {
  const base = baseParamsFromCacheQuery(params);
  const out: HinamizawaSearchParams = {};
  for (const [k, v] of Object.entries(base)) {
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
  const stale = ageMs > hubCacheTtlMs();

  return { status: stale ? "hit-stale" : "hit-fresh", row };
}

/** Lookup by base identity (mode/status/key/sort), ignoring secondary filters. */
export async function lookupCacheByBase(
  params: CacheQueryParams,
): Promise<CacheLookupResult> {
  return lookupCache(hashQueryParams(params));
}

function difficultyFromRaw(raw: unknown): HubSearchStub["beatmaps"][number] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id =
    typeof row.id === "number" && Number.isFinite(row.id) ? row.id : null;
  if (id == null || id <= 0) return null;
  const modeInt =
    typeof row.modeInt === "number"
      ? row.modeInt
      : typeof row.mode_int === "number"
        ? row.mode_int
        : 0;
  const keys =
    typeof row.keys === "number" && Number.isFinite(row.keys) ? row.keys : null;
  const stars =
    typeof row.stars === "number" && Number.isFinite(row.stars)
      ? row.stars
      : typeof row.difficulty_rating === "number"
        ? row.difficulty_rating
        : 0;
  const totalLength =
    typeof row.totalLength === "number"
      ? row.totalLength
      : typeof row.total_length === "number"
        ? row.total_length
        : null;
  return {
    id,
    version: typeof row.version === "string" ? row.version : "Unknown",
    stars,
    mode: typeof row.mode === "string" ? row.mode : "osu",
    modeInt,
    keys,
    totalLength,
  };
}

function stubFromSearchV2(set: SearchV2Set): HubSearchStub {
  return {
    id: set.SetID,
    artist: set.artist,
    title: set.title,
    creator: set.creator,
    status: set.status,
    bpm: set.bpm,
    favouriteCount: set.favouriteCount,
    playCount: set.playCount,
    hasVideo: set.hasVideo,
    rankedDate: set.rankedDate,
    lengthSeconds: set.lengthSeconds,
    beatmaps: set.beatmaps.map((d: SearchV2Difficulty) => ({
      id: d.id,
      version: d.version,
      stars: d.stars,
      mode: d.mode,
      modeInt: d.modeInt,
      keys: d.keys,
      totalLength: d.totalLength,
    })),
  };
}

function minimalStub(id: number): HubSearchStub {
  return {
    id,
    artist: "",
    title: `Beatmapset ${id}`,
    creator: "",
    status: "",
    bpm: null,
    favouriteCount: 0,
    playCount: 0,
    hasVideo: false,
    rankedDate: null,
    lengthSeconds: null,
    beatmaps: [],
  };
}

/**
 * Parse stored `beatmapset_ids` JSON: enriched stubs or legacy `number[]`.
 */
export function parseStoredStubs(raw: string): HubSearchStub[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: HubSearchStub[] = [];
  for (const item of parsed) {
    if (typeof item === "number" && Number.isSafeInteger(item) && item > 0) {
      out.push(minimalStub(item));
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id =
      typeof row.id === "number"
        ? row.id
        : typeof row.SetID === "number"
          ? row.SetID
          : null;
    if (id == null || id <= 0) continue;
    const beatmaps = Array.isArray(row.beatmaps)
      ? row.beatmaps
          .map(difficultyFromRaw)
          .filter((b): b is HubSearchStub["beatmaps"][number] => b != null)
      : [];
    out.push({
      id,
      artist: typeof row.artist === "string" ? row.artist : "",
      title:
        typeof row.title === "string"
          ? row.title
          : `Beatmapset ${id}`,
      creator: typeof row.creator === "string" ? row.creator : "",
      status: typeof row.status === "string" ? row.status : "",
      bpm: typeof row.bpm === "number" ? row.bpm : null,
      favouriteCount:
        typeof row.favouriteCount === "number" ? row.favouriteCount : 0,
      playCount: typeof row.playCount === "number" ? row.playCount : 0,
      hasVideo: row.hasVideo === true,
      rankedDate: typeof row.rankedDate === "string" ? row.rankedDate : null,
      lengthSeconds:
        typeof row.lengthSeconds === "number" ? row.lengthSeconds : null,
      beatmaps,
    });
  }
  return out;
}

function includesInsensitive(hay: string, needle: string): boolean {
  return hay.toLowerCase().includes(needle.toLowerCase());
}

/**
 * Filter enriched stubs by secondary GET /search params.
 * Star/key bounds use per-diff fields when present; bpm/length/name/creator are set-level.
 */
export function filterStubs(
  stubs: HubSearchStub[],
  secondary: SearchSecondaryFilters,
): HubSearchStub[] {
  const q = secondary.query?.trim();
  const creator = secondary.creator?.trim();
  const hasStar =
    secondary.min_stars != null || secondary.max_stars != null;
  const hasLength =
    secondary.min_length != null || secondary.max_length != null;

  return stubs.filter((set) => {
    if (q) {
      const blob = `${set.artist} ${set.title}`;
      if (!includesInsensitive(blob, q)) return false;
    }
    if (creator && !includesInsensitive(set.creator, creator)) return false;

    if (secondary.min_bpm != null || secondary.max_bpm != null) {
      if (set.bpm == null) return false;
      if (secondary.min_bpm != null && set.bpm < secondary.min_bpm) return false;
      if (secondary.max_bpm != null && set.bpm > secondary.max_bpm) return false;
    }

    if (hasLength) {
      const len = set.lengthSeconds;
      if (len == null) return false;
      if (secondary.min_length != null && len < secondary.min_length) {
        return false;
      }
      if (secondary.max_length != null && len > secondary.max_length) {
        return false;
      }
    }

    if (hasStar) {
      if (set.beatmaps.length === 0) return false;
      const ok = set.beatmaps.some((d) => {
        if (secondary.min_stars != null && d.stars < secondary.min_stars) {
          return false;
        }
        if (secondary.max_stars != null && d.stars > secondary.max_stars) {
          return false;
        }
        return true;
      });
      if (!ok) return false;
    }

    return true;
  });
}

export function edgeCacheTtlSecondsForRow(
  row: Pick<typeof searchCache.$inferSelect, "refreshIntervalMinutes">,
): number {
  const cap = hubSearchEdgeCacheMaxAgeSec();
  const interval = row.refreshIntervalMinutes;
  if (interval != null && interval > 0) {
    return Math.min(interval * 60, cap);
  }
  return Math.min(Math.floor(hubCacheTtlMs() / 1000), cap);
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

/**
 * @deprecated Prefer embedded search `cs` via `fetchAllBeatmapsetStubs({ keymode })`.
 * Per-set `/s/{id}` storms rate-limit Hinamizawa and silently drop 7K maps.
 */
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

  const keptSet = new Set(kept);
  return unique.filter((id) => keptSet.has(id));
}

/**
 * Run the hinamizawa search for a cache entry and upsert enriched stubs.
 * Keymode uses embedded search `beatmaps[].cs` during the crawl (same as
 * Download Maps). Do not N+1 `/s/{id}` — Hinamizawa 429s were silently
 * dropping most 7K sets and truncating the hub search index.
 */
export async function refreshCache(cacheId: number): Promise<void> {
  const entry = await db
    .select()
    .from(searchCache)
    .where(eq(searchCache.id, cacheId))
    .get();

  if (!entry) throw new Error(`Cache entry ${cacheId} not found`);

  const params = baseParamsFromCacheQuery(
    JSON.parse(entry.queryParams) as CacheQueryParams,
  );
  const hinaiParams = stripRoxysuCacheParams(params);
  const keymode = cacheKeymode(params);

  console.log(
    `[cache] Refreshing cache ${cacheId} (${entry.label || entry.queryHash})${
      keymode != null ? ` key=${keymode}` : ""
    }`,
  );

  const result = await fetchAllBeatmapsetStubs(hinaiParams, {
    keymode: keymode ?? undefined,
    onProgress: (scraped, catalogueTotal, kept) => {
      process.stdout.write(
        `\r[cache] scraped ${scraped}/${catalogueTotal} sets` +
          (keymode != null ? ` · kept ${kept} (${keymode}K)` : ""),
      );
    },
  });
  console.log();

  const stubs = result.stubs.map(stubFromSearchV2);
  const now = new Date();
  await db
    .update(searchCache)
    .set({
      beatmapsetIds: JSON.stringify(stubs),
      totalCount: stubs.length,
      cachedAt: now,
      lastRefreshAt: now,
      refreshError: null,
      refreshBackoffUntil: null,
      // Keep stored params as base-only identity.
      queryParams: JSON.stringify(params),
      queryHash: hashQueryParams(params),
    })
    .where(eq(searchCache.id, cacheId));

  console.log(
    `[cache] Done — ${stubs.length} stubs stored` +
      (keymode != null
        ? ` (${keymode}K from ${result.totalCount} ranked/loved catalogue)`
        : ` across ${result.pages} pages`),
  );
}

/**
 * Slice filtered stubs for a paginated /search response.
 */
export function sliceStubs(
  stubs: HubSearchStub[],
  page: number,
  limit: number,
): { stubs: HubSearchStub[]; ids: number[]; total: number } {
  const start = page * limit;
  const pageStubs = stubs.slice(start, start + limit);
  return {
    stubs: pageStubs,
    ids: pageStubs.map((s) => s.id),
    total: stubs.length,
  };
}

/**
 * @deprecated Prefer `parseStoredStubs` + `filterStubs` + `sliceStubs`.
 * Slice a cached beatmapset_ids JSON array for a paginated /search response.
 */
export function sliceIds(
  raw: string,
  page: number,
  limit: number,
): { ids: number[]; total: number } {
  const all = parseStoredStubs(raw);
  const sliced = sliceStubs(all, page, limit);
  return { ids: sliced.ids, total: sliced.total };
}

export function normalizeRefreshIntervalMinutes(
  value: number | null | undefined,
): number | null {
  if (value == null || value === 0) return null;
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return value;
}
