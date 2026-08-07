import type { Db } from "../db-runtime";
import {
  OnlineQueryError,
  parseOnlineMirrorQuery,
  setMatchesOnlinePostFilters,
  type OnlineMirrorQuery,
  type OnlinePostFilter,
} from "./onlineQuery";
import { loadIdsToHideFromDownloadSearch } from "./pendingDownloads";
import { getActiveBeatmapMirrorProvider } from "./providers";
import {
  buildMirrorSearchUrl,
  extractSearchBeatmapsets,
  normalizeMirrorSearchResult,
  type MirrorSearchParams,
  type OnlineBeatmapSet,
} from "./search";
import { MIRROR_USER_AGENT } from "./userAgent";

export type MirrorSearchResult = {
  provider: string;
  page: number;
  excludeOwned: boolean;
  ownedSkipped: number;
  /** Hidden because Roxysu already downloaded them (awaiting lazer import/sync). */
  pendingSkipped: number;
  mirrorCount: number;
  hasMore: boolean;
  items: OnlineBeatmapSet[];
  note: string;
  /** Echo of the QL / bridged query when search used app QL. */
  query?: string;
};

const MIRROR_FETCH_TIMEOUT_MS = 20_000;
/** Nerinyan / osu.direct / hinai typically return up to this many sets per page. */
export const MIRROR_PAGE_CAPACITY = 50;
/** Max raw mirror pages to scan while filling one UI page under post-filters. */
const MAX_OVERFETCH_PAGES = 20;

export { OnlineQueryError, parseOnlineMirrorQuery };
export type { OnlineMirrorQuery, OnlinePostFilter };

async function fetchMirrorPage(
  providerId: "nerinyan" | "osu.direct" | "hinai",
  params: MirrorSearchParams,
): Promise<{ rawCount: number; sets: OnlineBeatmapSet[] }> {
  const url = buildMirrorSearchUrl(providerId, params);
  const res = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": MIRROR_USER_AGENT,
    },
    signal: AbortSignal.timeout(MIRROR_FETCH_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`Mirror search failed: HTTP ${res.status}`);
  }

  const payload: unknown = await res.json();
  const rawSets = extractSearchBeatmapsets(payload);
  const sets: OnlineBeatmapSet[] = [];
  for (const raw of rawSets) {
    const set = normalizeMirrorSearchResult(providerId, raw);
    if (set) sets.push(set);
  }
  return { rawCount: rawSets.length, sets };
}

export type SearchOnlineOpts = MirrorSearchParams & {
  excludeOwned?: boolean;
  /**
   * When set, parse as app QL and ignore legacy mode/status/q fields for
   * filtering (sort/page/excludeOwned still apply from opts).
   */
  query?: string;
  /** Pre-parsed bridge (batch crawl reuses one parse). */
  onlineQuery?: OnlineMirrorQuery;
};

/**
 * Search online beatmapsets. Prefer `query` (app QL) when provided; otherwise
 * use legacy MirrorSearchParams (mode/status/q dropdowns).
 */
export async function searchOnlineBeatmapsets(
  db: Db,
  params: SearchOnlineOpts,
): Promise<MirrorSearchResult> {
  const provider = getActiveBeatmapMirrorProvider();
  const page = Math.max(0, params.page ?? 0);
  const excludeOwned = params.excludeOwned !== false;

  let onlineQuery: OnlineMirrorQuery | null = params.onlineQuery ?? null;
  if (!onlineQuery && params.query != null) {
    onlineQuery = parseOnlineMirrorQuery(params.query, {
      defaultMode: params.mode,
      defaultStatus: params.status,
      defaultSort: params.sort,
    });
  }

  const mirrorBase: MirrorSearchParams = onlineQuery
    ? {
        ...onlineQuery.mirrorParams,
        sort: params.sort ?? onlineQuery.mirrorParams.sort,
      }
    : {
        q: params.q,
        mode: params.mode,
        status: params.status,
        sort: params.sort,
        minStars: params.minStars,
        maxStars: params.maxStars,
        minBpm: params.minBpm,
        maxBpm: params.maxBpm,
        minLength: params.minLength,
        maxLength: params.maxLength,
        creator: params.creator,
      };

  const postFilters = onlineQuery?.postFilters ?? [];
  const needsOverfetch = postFilters.length > 0;

  const { owned, pending, hide } = excludeOwned
    ? await loadIdsToHideFromDownloadSearch(db)
    : {
        owned: new Set<number>(),
        pending: new Set<number>(),
        hide: new Set<number>(),
      };

  const matched: OnlineBeatmapSet[] = [];
  const seen = new Set<number>();
  let ownedSkipped = 0;
  let pendingSkipped = 0;
  let lastRawCount = 0;
  let mirrorHasMore = true;
  let pagesScanned = 0;

  // With post-filters we walk from mirror page 0 and skip the first
  // `page * CAPACITY` matches so UI page N is still a full page of matches.
  // Without post-filters we jump straight to mirror page `page`.
  const skipMatches = needsOverfetch ? page * MIRROR_PAGE_CAPACITY : 0;
  let matchIndex = 0;
  let mirrorPage = needsOverfetch ? 0 : page;

  while (matched.length < MIRROR_PAGE_CAPACITY && mirrorHasMore) {
    if (needsOverfetch && pagesScanned >= MAX_OVERFETCH_PAGES && matched.length === 0) {
      break;
    }
    if (needsOverfetch && pagesScanned >= MAX_OVERFETCH_PAGES * (page + 2)) {
      break;
    }

    const { rawCount, sets } = await fetchMirrorPage(provider.id, {
      ...mirrorBase,
      page: mirrorPage,
    });
    pagesScanned += 1;
    lastRawCount = rawCount;
    mirrorHasMore = rawCount >= MIRROR_PAGE_CAPACITY;

    for (const set of sets) {
      if (seen.has(set.id)) continue;
      seen.add(set.id);

      if (!setMatchesOnlinePostFilters(set, postFilters)) continue;

      if (excludeOwned && hide.has(set.id)) {
        if (owned.has(set.id)) ownedSkipped += 1;
        else if (pending.has(set.id)) pendingSkipped += 1;
        continue;
      }

      if (matchIndex >= skipMatches) {
        matched.push(set);
        if (matched.length >= MIRROR_PAGE_CAPACITY) break;
      }
      matchIndex += 1;
    }

    if (!needsOverfetch) break;
    mirrorPage += 1;
    if (!mirrorHasMore) break;
  }

  const hasMore = needsOverfetch
    ? mirrorHasMore || matched.length >= MIRROR_PAGE_CAPACITY
    : lastRawCount >= MIRROR_PAGE_CAPACITY;

  return {
    provider: provider.id,
    page,
    excludeOwned,
    ownedSkipped,
    pendingSkipped,
    mirrorCount: lastRawCount,
    hasMore,
    items: matched,
    query: onlineQuery?.rawQuery,
    note:
      "Downloads save into the beatmaps folder. Maps already in your library or recently downloaded (awaiting import) are hidden by default.",
  };
}

/**
 * Crawl mirror pages with a bridged QL query until exhausted or caps hit.
 * Used by "download all missing" and by count-only previews.
 */
export async function collectMatchingOnlineBeatmapsets(
  db: Db,
  opts: {
    onlineQuery: OnlineMirrorQuery;
    excludeOwned?: boolean;
    maxPages?: number;
    maxSets?: number;
    /** When true, only count matches — do not retain set payloads. */
    countOnly?: boolean;
    shouldStop?: () => boolean;
    onPage?: (info: {
      mirrorPage: number;
      matchedSoFar: number;
      ownedSkipped: number;
    }) => void;
  },
): Promise<{
  sets: OnlineBeatmapSet[];
  matched: number;
  ownedSkipped: number;
  pagesScanned: number;
  hitPageCap: boolean;
  hitSetCap: boolean;
}> {
  const provider = getActiveBeatmapMirrorProvider();
  const excludeOwned = opts.excludeOwned !== false;
  const maxPages = opts.maxPages ?? 200;
  const maxSets = opts.maxSets ?? 10_000;
  const countOnly = opts.countOnly === true;
  const postFilters = opts.onlineQuery.postFilters;
  const { owned, pending, hide } = excludeOwned
    ? await loadIdsToHideFromDownloadSearch(db)
    : {
        owned: new Set<number>(),
        pending: new Set<number>(),
        hide: new Set<number>(),
      };

  const sets: OnlineBeatmapSet[] = [];
  const seen = new Set<number>();
  let matched = 0;
  let ownedSkipped = 0;
  let pagesScanned = 0;
  let hitPageCap = false;
  let hitSetCap = false;
  let mirrorHasMore = true;

  for (let mirrorPage = 0; mirrorHasMore; mirrorPage += 1) {
    if (opts.shouldStop?.()) break;
    if (pagesScanned >= maxPages) {
      hitPageCap = true;
      break;
    }

    const { rawCount, sets: pageSets } = await fetchMirrorPage(provider.id, {
      ...opts.onlineQuery.mirrorParams,
      page: mirrorPage,
    });
    pagesScanned += 1;
    mirrorHasMore = rawCount >= MIRROR_PAGE_CAPACITY;

    for (const set of pageSets) {
      if (seen.has(set.id)) continue;
      seen.add(set.id);
      if (!setMatchesOnlinePostFilters(set, postFilters)) continue;

      if (excludeOwned && hide.has(set.id)) {
        if (owned.has(set.id) || pending.has(set.id)) ownedSkipped += 1;
        continue;
      }

      matched += 1;
      if (!countOnly) sets.push(set);
      if (matched >= maxSets) {
        hitSetCap = true;
        break;
      }
    }

    opts.onPage?.({
      mirrorPage,
      matchedSoFar: matched,
      ownedSkipped,
    });

    if (hitSetCap) break;
    if (!mirrorHasMore) break;
  }

  return {
    sets,
    matched,
    ownedSkipped,
    pagesScanned,
    hitPageCap,
    hitSetCap,
  };
}

const COUNT_MAX_PAGES = 200;
const COUNT_MAX_SETS = 10_000;

/** Count matching missing sets for a QL query (no downloads). */
export async function countMatchingOnlineBeatmapsets(
  db: Db,
  opts: {
    query: string;
    sort?: MirrorSearchParams["sort"];
    excludeOwned?: boolean;
    maxPages?: number;
    maxSets?: number;
  },
): Promise<{
  query: string;
  matched: number;
  ownedSkipped: number;
  pagesScanned: number;
  hitCap: boolean;
  cappedAt: { maxPages: number; maxSets: number };
}> {
  const onlineQuery = parseOnlineMirrorQuery(opts.query, {
    defaultSort: opts.sort ?? "ranked_desc",
  });
  const maxPages = Math.min(
    COUNT_MAX_PAGES,
    Math.max(1, opts.maxPages ?? COUNT_MAX_PAGES),
  );
  const maxSets = Math.min(
    COUNT_MAX_SETS,
    Math.max(1, opts.maxSets ?? COUNT_MAX_SETS),
  );
  const result = await collectMatchingOnlineBeatmapsets(db, {
    onlineQuery,
    excludeOwned: opts.excludeOwned !== false,
    maxPages,
    maxSets,
    countOnly: true,
  });
  return {
    query: onlineQuery.rawQuery,
    matched: result.matched,
    ownedSkipped: result.ownedSkipped,
    pagesScanned: result.pagesScanned,
    hitCap: result.hitPageCap || result.hitSetCap,
    cappedAt: { maxPages, maxSets },
  };
}
