import type { MirrorSearchParams, OnlineBeatmapSet } from "./search";
import { MIRROR_USER_AGENT } from "./userAgent";

const HUB_SEARCH_TIMEOUT_MS = 8_000;

export type HubSearchCacheResult = {
  cached: true;
  stale: boolean;
  total: number;
  page: number;
  limit: number;
  beatmapsetIds: number[];
  label: string | null;
};

function hubBaseUrl(): string | null {
  const raw = process.env.HUB_URL?.trim();
  if (!raw) return null;
  return raw.replace(/\/$/, "");
}

/** Map local mirror search params to hub/hinamizawa query string fields. */
export function mirrorParamsToHubQuery(
  params: MirrorSearchParams,
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
  return out;
}

/**
 * Ask the hub search cache. Returns a HIT payload only when the hub reports
 * `cached: true`. On miss/error/unavailable returns null so callers fall back
 * to the live mirror.
 */
export async function tryHubCachedSearch(
  params: MirrorSearchParams & { page?: number; limit?: number },
): Promise<HubSearchCacheResult | null> {
  const base = hubBaseUrl();
  if (!base) return null;

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
      label?: string | null;
    };
    if (!body.cached || !Array.isArray(body.beatmapsetIds)) return null;
    return {
      cached: true,
      stale: !!body.stale,
      total: body.total ?? body.beatmapsetIds.length,
      page: body.page ?? params.page ?? 0,
      limit: body.limit ?? params.limit ?? 100,
      beatmapsetIds: body.beatmapsetIds,
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
    beatmaps: [],
  }));
}
