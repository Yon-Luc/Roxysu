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
  extractTotalCount,
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
export const MIRROR_PAGE_CAPACITY = 100;
/** Max raw mirror pages to scan while filling one UI page under post-filters. */
const MAX_OVERFETCH_PAGES = 20;

/**
 * Number of pages to fetch in parallel when crawling with post-filters or
 * during batch collect. The hinai JSON search lane is unlimited per the docs,
 * so 4 concurrent requests is safe and keeps the pipeline full without being
 * rude to other mirrors.
 */
const PARALLEL_FETCH_WIDTH = 4;

export { OnlineQueryError, parseOnlineMirrorQuery };
export type { OnlineMirrorQuery, OnlinePostFilter };

async function fetchMirrorPage(
  providerId: "nerinyan" | "osu.direct" | "hinai",
  params: MirrorSearchParams,
): Promise<{ rawCount: number; sets: OnlineBeatmapSet[]; totalCount: number | null }> {
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
  const totalCount = extractTotalCount(payload);
  const sets: OnlineBeatmapSet[] = [];
  for (const raw of rawSets) {
    const set = normalizeMirrorSearchResult(providerId, raw);
    if (set) sets.push(set);
  }
  return { rawCount: rawSets.length, sets, totalCount };
}

/**
 * Fetch `count` consecutive mirror pages starting at `startPage` in parallel.
 * Pages that fail are returned as empty (rawCount=0, sets=[]) so the caller
 * can stop gracefully rather than throwing.
 */
async function fetchMirrorPagesBatch(
  providerId: "nerinyan" | "osu.direct" | "hinai",
  baseParams: MirrorSearchParams,
  startPage: number,
  count: number,
): Promise<Array<{ rawCount: number; sets: OnlineBeatmapSet[]; totalCount: number | null }>> {
  const fetches = Array.from({ length: count }, (_, i) =>
    fetchMirrorPage(providerId, { ...baseParams, page: startPage + i }).catch(
      () => ({ rawCount: 0, sets: [] as OnlineBeatmapSet[], totalCount: null }),
    ),
  );
  return Promise.all(fetches);
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
 *
 * When post-filters are active we must overfetch. After the first page comes
 * back we know whether there are more pages; subsequent pages are fetched in
 * parallel batches of PARALLEL_FETCH_WIDTH so we don't stall on each
 * round-trip individually.
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

  if (!needsOverfetch) {
    // Fast path: no post-filters — fetch exactly the requested mirror page.
    const { rawCount, sets } = await fetchMirrorPage(provider.id, {
      ...mirrorBase,
      page: mirrorPage,
    });
    lastRawCount = rawCount;
    mirrorHasMore = rawCount >= MIRROR_PAGE_CAPACITY;
    for (const set of sets) {
      if (seen.has(set.id)) continue;
      seen.add(set.id);
      if (excludeOwned && hide.has(set.id)) {
        if (owned.has(set.id)) ownedSkipped += 1;
        else if (pending.has(set.id)) pendingSkipped += 1;
        continue;
      }
      matched.push(set);
    }
  } else {
    // Overfetch path: we need to scan multiple pages to fill one UI page.
    // Fetch the first page alone so we can bail early if it's the last page,
    // then switch to parallel batches for the rest.
    const firstResult = await fetchMirrorPage(provider.id, {
      ...mirrorBase,
      page: mirrorPage,
    });
    pagesScanned += 1;
    lastRawCount = firstResult.rawCount;
    mirrorHasMore = firstResult.rawCount >= MIRROR_PAGE_CAPACITY;

    const pagesToProcess: Array<{ rawCount: number; sets: OnlineBeatmapSet[] }> =
      [firstResult];

    // Helper to drain a batch of page results into matched/seen/skipped.
    const drainPages = (
      pages: Array<{ rawCount: number; sets: OnlineBeatmapSet[] }>,
    ): boolean => {
      for (const { rawCount, sets } of pages) {
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
            if (matched.length >= MIRROR_PAGE_CAPACITY) return true;
          }
          matchIndex += 1;
        }

        if (!mirrorHasMore) return false;
      }
      return false;
    };

    mirrorPage += 1;

    // Drain the first page.
    let done = drainPages(pagesToProcess);

    // Now fetch in parallel batches until we have enough matches or run dry.
    while (!done && mirrorHasMore) {
      if (pagesScanned >= MAX_OVERFETCH_PAGES && matched.length === 0) break;
      if (pagesScanned >= MAX_OVERFETCH_PAGES * (page + 2)) break;

      const batchSize = Math.min(
        PARALLEL_FETCH_WIDTH,
        MAX_OVERFETCH_PAGES * (page + 2) - pagesScanned,
      );
      if (batchSize <= 0) break;

      const batchPages = await fetchMirrorPagesBatch(
        provider.id,
        mirrorBase,
        mirrorPage,
        batchSize,
      );
      pagesScanned += batchPages.length;
      mirrorPage += batchPages.length;

      done = drainPages(batchPages);

      // If any page in the batch was short, the mirror has no more results.
      if (batchPages.some((p) => p.rawCount < MIRROR_PAGE_CAPACITY)) {
        mirrorHasMore = false;
        break;
      }
    }
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
 *
 * Pages are fetched in parallel batches of PARALLEL_FETCH_WIDTH after the
 * first page establishes that more results exist.
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

  for (
    let mirrorPage = 0;
    mirrorHasMore && !hitPageCap && !hitSetCap;
    mirrorPage += PARALLEL_FETCH_WIDTH
  ) {
    if (opts.shouldStop?.()) break;

    const remaining = maxPages - pagesScanned;
    if (remaining <= 0) {
      hitPageCap = true;
      break;
    }

    const batchSize = Math.min(PARALLEL_FETCH_WIDTH, remaining);
    const batchResults = await fetchMirrorPagesBatch(
      provider.id,
      opts.onlineQuery.mirrorParams,
      mirrorPage,
      batchSize,
    );

    for (let i = 0; i < batchResults.length; i++) {
      if (opts.shouldStop?.()) break;

      const { rawCount, sets: pageSets } = batchResults[i];
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
        mirrorPage: mirrorPage + i,
        matchedSoFar: matched,
        ownedSkipped,
      });

      if (hitSetCap) break;

      // If this page was short, no point fetching more pages in the batch.
      if (!mirrorHasMore) {
        mirrorHasMore = false;
        break;
      }
    }

    if (pagesScanned >= maxPages) {
      hitPageCap = true;
    }
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

const COUNT_MAX_PAGES = 1000;
const COUNT_MAX_SETS = 100_000;

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

  // Fast path: hinai v2 returns total_count on the first page for locally-served
  // queries (ranked/loved, no post-filters). When available, skip the full crawl.
  // We can only use this when excludeOwned is false — we can't subtract owned
  // maps without knowing which specific sets appear in the results.
  const hasPostFilters = onlineQuery.postFilters.length > 0;
  const excludeOwned = opts.excludeOwned !== false;
  const provider = getActiveBeatmapMirrorProvider();

  if (!hasPostFilters && !excludeOwned && provider.id === "hinai") {
    try {
      const firstPage = await fetchMirrorPage(provider.id, {
        ...onlineQuery.mirrorParams,
        page: 0,
      });
      if (firstPage.totalCount !== null) {
        return {
          query: onlineQuery.rawQuery,
          matched: firstPage.totalCount,
          ownedSkipped: 0,
          pagesScanned: 1,
          hitCap: false,
          cappedAt: { maxPages, maxSets },
        };
      }
    } catch {
      // Fall through to crawl if the fast-path fetch fails.
    }
  }

  const result = await collectMatchingOnlineBeatmapsets(db, {
    onlineQuery,
    excludeOwned,
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
