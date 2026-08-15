import { resolveHubBaseUrl } from "../hubUrl";
import type { MirrorSearchParams, OnlineBeatmapSet } from "./search";
import { MIRROR_USER_AGENT } from "./userAgent";

const HUB_SEARCH_TIMEOUT_MS = 8_000;

/** Enriched stub from Hub GET /search `beatmapsets`. */
export type HubSearchBeatmapset = {
  id: number;
  artist?: string;
  title?: string;
  creator?: string;
  status?: string;
  bpm?: number | null;
  favouriteCount?: number;
  playCount?: number;
  hasVideo?: boolean;
  rankedDate?: string | null;
  lengthSeconds?: number | null;
  beatmaps?: Array<{
    id: number;
    version?: string;
    stars?: number;
    mode?: string;
    modeInt?: number;
    keys?: number | null;
    totalLength?: number | null;
  }>;
};

export type HubSearchCacheResult = {
  cached: true;
  stale: boolean;
  total: number;
  page: number;
  limit: number;
  beatmapsetIds: number[];
  beatmapsets: HubSearchBeatmapset[];
  label: string | null;
};

/** Map local mirror search params to hub/hinamizawa query string fields. */
export function mirrorParamsToHubQuery(
  params: MirrorSearchParams & { key?: number },
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (params.q?.trim()) out.query = params.q.trim();
  if (params.mode && params.mode !== "any") {
    const modeInt =
      params.mode === "osu"
        ? 0
        : params.mode === "taiko"
          ? 1
          : params.mode === "fruits"
            ? 2
            : 3;
    out.mode = modeInt;
  }
  if (params.status && params.status !== "any") out.status = params.status;
  if (params.minStars != null) out.min_stars = params.minStars;
  if (params.maxStars != null) out.max_stars = params.maxStars;
  if (params.minBpm != null) out.min_bpm = params.minBpm;
  if (params.maxBpm != null) out.max_bpm = params.maxBpm;
  if (params.minLength != null) out.min_length = params.minLength;
  if (params.maxLength != null) out.max_length = params.maxLength;
  if (params.creator?.trim()) out.creator = params.creator.trim();
  if (params.sort) out.sort = params.sort;
  if (params.key != null && Number.isSafeInteger(params.key) && params.key > 0) {
    out.key = params.key;
  }
  return out;
}

/**
 * Ask the hub search cache. Returns a HIT payload only when the hub reports
 * `cached: true`. On miss/error/unavailable returns null so callers fall back
 * to the live mirror.
 */
export async function tryHubCachedSearch(
  params: MirrorSearchParams & { page?: number; limit?: number; key?: number },
): Promise<HubSearchCacheResult | null> {
  const base = resolveHubBaseUrl();

  const query = mirrorParamsToHubQuery(params);
  const url = new URL(`${base}/search`);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set("page", String(params.page ?? 0));
  url.searchParams.set("limit", String(params.limit ?? 100));

  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": MIRROR_USER_AGENT,
      },
      signal: AbortSignal.timeout(HUB_SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      cached?: boolean;
      stale?: boolean;
      total?: number;
      page?: number;
      limit?: number;
      beatmapsetIds?: number[];
      beatmapsets?: HubSearchBeatmapset[];
      label?: string | null;
    };
    if (!body.cached || !Array.isArray(body.beatmapsetIds)) return null;
    const beatmapsets = Array.isArray(body.beatmapsets) ? body.beatmapsets : [];
    return {
      cached: true,
      stale: !!body.stale,
      total: body.total ?? body.beatmapsetIds.length,
      page: body.page ?? params.page ?? 0,
      limit: body.limit ?? params.limit ?? 100,
      beatmapsetIds: body.beatmapsetIds,
      beatmapsets,
      label: body.label ?? null,
    };
  } catch {
    return null;
  }
}

export function hubIdsToStubSets(ids: number[]): OnlineBeatmapSet[] {
  return ids.map((id) => ({
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
  }));
}

/** Map Hub enriched stubs (or fall back to ids) into OnlineBeatmapSet. */
export function hubResultToOnlineSets(hit: HubSearchCacheResult): OnlineBeatmapSet[] {
  if (hit.beatmapsets.length > 0) {
    return hit.beatmapsets.map((set) => hubStubToOnlineSet(set));
  }
  return hubIdsToStubSets(hit.beatmapsetIds);
}

export function hubStubToOnlineSet(set: HubSearchBeatmapset): OnlineBeatmapSet {
  const beatmaps = (set.beatmaps ?? []).map((d, i) => ({
    id: d.id > 0 ? d.id : set.id * 1000 + i + 1,
    version: d.version ?? "Unknown",
    stars: typeof d.stars === "number" ? d.stars : 0,
    mode: d.mode ?? "osu",
    modeInt: typeof d.modeInt === "number" ? d.modeInt : 0,
    keys: d.keys ?? null,
    totalLength: d.totalLength ?? null,
  }));
  let lengthSeconds = set.lengthSeconds ?? null;
  if (lengthSeconds == null) {
    for (const b of beatmaps) {
      if (b.totalLength != null && b.totalLength > 0) {
        lengthSeconds =
          lengthSeconds == null
            ? b.totalLength
            : Math.max(lengthSeconds, b.totalLength);
      }
    }
  }
  return {
    id: set.id,
    artist: set.artist ?? "",
    title: set.title?.trim() ? set.title : `Beatmapset ${set.id}`,
    creator: set.creator ?? "",
    status: set.status ?? "",
    bpm: set.bpm ?? null,
    favouriteCount: set.favouriteCount ?? 0,
    playCount: set.playCount ?? 0,
    hasVideo: set.hasVideo === true,
    rankedDate: set.rankedDate ?? null,
    lengthSeconds,
    beatmaps,
  };
}

/** Hub GET /search limit cap (must match Hub route schema). */
export const HUB_SEARCH_PAGE_LIMIT = 100;
const HUB_FETCH_PARALLEL = 8;

export type HubCachedIdList = {
  beatmapsetIds: number[];
  /** Enriched sets when Hub returned beatmapsets; otherwise id stubs. */
  sets: OnlineBeatmapSet[];
  total: number;
  stale: boolean;
  label: string | null;
  pagesFetched: number;
  /** True when we stopped before every hub page (cap / cancel). */
  truncated: boolean;
};

/**
 * Pull every beatmapset id from a primed hub search cache entry.
 * Returns null on miss / error so callers fall back to the live mirror crawl.
 */
export async function tryFetchAllHubCachedIds(
  params: MirrorSearchParams & { key?: number },
  opts?: {
    shouldStop?: () => boolean;
    /** Max hub pages to request (each page ≤ HUB_SEARCH_PAGE_LIMIT ids). */
    maxPages?: number;
  },
): Promise<HubCachedIdList | null> {
  const maxPages = Math.max(1, opts?.maxPages ?? 10_000);
  const first = await tryHubCachedSearch({
    ...params,
    page: 0,
    limit: HUB_SEARCH_PAGE_LIMIT,
  });
  if (!first) return null;

  const total = first.total;
  const ids: number[] = [...first.beatmapsetIds];
  const sets: OnlineBeatmapSet[] = hubResultToOnlineSets(first);
  let pagesFetched = 1;
  const totalPages = Math.max(1, Math.ceil(total / HUB_SEARCH_PAGE_LIMIT));
  const pagesToFetch = Math.min(totalPages, maxPages);

  if (pagesToFetch <= 1 || ids.length >= total) {
    return {
      beatmapsetIds: ids,
      sets,
      total,
      stale: first.stale,
      label: first.label,
      pagesFetched,
      truncated: totalPages > maxPages && ids.length < total,
    };
  }

  for (let page = 1; page < pagesToFetch; page += HUB_FETCH_PARALLEL) {
    if (opts?.shouldStop?.()) {
      return {
        beatmapsetIds: ids,
        sets,
        total,
        stale: first.stale,
        label: first.label,
        pagesFetched,
        truncated: true,
      };
    }

    const batchPages: number[] = [];
    for (
      let p = page;
      p < Math.min(page + HUB_FETCH_PARALLEL, pagesToFetch);
      p += 1
    ) {
      batchPages.push(p);
    }

    const results = await Promise.all(
      batchPages.map((p) =>
        tryHubCachedSearch({
          ...params,
          page: p,
          limit: HUB_SEARCH_PAGE_LIMIT,
        }),
      ),
    );

    for (const hit of results) {
      // Incomplete cache read → force mirror fallback rather than a wrong count.
      if (!hit) return null;
      pagesFetched += 1;
      ids.push(...hit.beatmapsetIds);
      sets.push(...hubResultToOnlineSets(hit));
    }
  }

  return {
    beatmapsetIds: ids,
    sets,
    total,
    stale: first.stale,
    label: first.label,
    pagesFetched,
    truncated: totalPages > maxPages && ids.length < total,
  };
}
