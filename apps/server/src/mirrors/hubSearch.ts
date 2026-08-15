import { resolveHubBaseUrl } from "../hubUrl";
import type { MirrorSearchParams, OnlineBeatmapSet } from "./search";
import { MIRROR_USER_AGENT } from "./userAgent";

const HUB_SEARCH_TIMEOUT_MS = 8_000;
const HUB_SEARCH_ALL_TIMEOUT_MS = 20_000;
const HUB_CIRCUIT_COOLDOWN_MS = 30_000;

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

let hubCircuitOpenUntil = 0;

export function resetHubSearchCircuit(): void {
  hubCircuitOpenUntil = 0;
}

export function isHubSearchCircuitOpen(): boolean {
  return Date.now() < hubCircuitOpenUntil;
}

function noteHubSuccess(): void {
  hubCircuitOpenUntil = 0;
}

function noteHubFailure(): void {
  hubCircuitOpenUntil = Date.now() + HUB_CIRCUIT_COOLDOWN_MS;
}

function isServerFailure(status: number): boolean {
  return status >= 500;
}

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
  if (isHubSearchCircuitOpen()) return null;

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
    if (!res.ok) {
      if (isServerFailure(res.status)) noteHubFailure();
      return null;
    }
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
    noteHubSuccess();
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
    noteHubFailure();
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

function compactToOnlineSet(row: {
  id: number;
  artist?: string;
  title?: string;
}): OnlineBeatmapSet {
  return {
    id: row.id,
    artist: row.artist ?? "",
    title: row.title?.trim() ? row.title : `Beatmapset ${row.id}`,
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
 * Pull every matching beatmapset from a primed hub search index in one dump.
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
  if (opts?.shouldStop?.()) {
    return {
      beatmapsetIds: [],
      sets: [],
      total: 0,
      stale: false,
      label: null,
      pagesFetched: 0,
      truncated: true,
    };
  }
  if (isHubSearchCircuitOpen()) return null;

  const maxPages = Math.max(1, opts?.maxPages ?? 10_000);
  const maxSets = maxPages * HUB_SEARCH_PAGE_LIMIT;
  const base = resolveHubBaseUrl();
  const query = mirrorParamsToHubQuery(params);
  const url = new URL(`${base}/search/all`);
  for (const [k, v] of Object.entries(query)) {
    url.searchParams.set(k, String(v));
  }
  url.searchParams.set("fields", "compact");
  url.searchParams.set("max", String(Math.min(maxSets, 100_000)));

  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": MIRROR_USER_AGENT,
      },
      signal: AbortSignal.timeout(HUB_SEARCH_ALL_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (isServerFailure(res.status)) noteHubFailure();
      return null;
    }
    const body = (await res.json()) as {
      cached?: boolean;
      stale?: boolean;
      total?: number;
      truncated?: boolean;
      beatmapsetIds?: number[];
      beatmapsets?: Array<{ id: number; artist?: string; title?: string }>;
      label?: string | null;
    };
    if (!body.cached || !Array.isArray(body.beatmapsetIds)) return null;
    noteHubSuccess();

    const ids = body.beatmapsetIds;
    const compact = Array.isArray(body.beatmapsets) ? body.beatmapsets : [];
    const sets =
      compact.length > 0
        ? compact.map((row) => compactToOnlineSet(row))
        : hubIdsToStubSets(ids);

    return {
      beatmapsetIds: ids,
      sets,
      total: body.total ?? ids.length,
      stale: !!body.stale,
      label: body.label ?? null,
      pagesFetched: 1,
      truncated: body.truncated === true || ids.length < (body.total ?? ids.length),
    };
  } catch {
    noteHubFailure();
    return null;
  }
}
