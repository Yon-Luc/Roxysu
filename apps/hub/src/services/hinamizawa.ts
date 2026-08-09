const BASE = "https://mirror.hinamizawa.ai";
const UA = "roxysu-hub/0.1 (+https://github.com/Yon-Luc/Roxysu)";

export interface HinamizawaSearchParams {
  query?: string;
  mode?: number;       // 0 osu, 1 taiko, 2 catch, 3 mania
  status?: string;     // ranked, loved, pending, graveyard
  min_stars?: number;
  max_stars?: number;
  min_bpm?: number;
  max_bpm?: number;
  min_length?: number;
  max_length?: number;
  creator?: string;
  sort?: string;
  [key: string]: string | number | undefined;
}

interface SearchV2Result {
  SetID: number;
  Title: string;
  Artist: string;
  Creator: string;
  RankedStatus: number;
}

interface SearchV2Response {
  results: SearchV2Result[];
  total_count: number;
  total_pages: number;
}

/**
 * Fetch one page from the v2 search endpoint.
 * v2 uses string status values (ranked, loved…) and page/limit pagination.
 * It is answered from the local tantivy index (~3ms) when status is ranked or loved.
 */
async function fetchPage(
  params: HinamizawaSearchParams,
  page: number,
  limit = 100
): Promise<SearchV2Response> {
  const qs = new URLSearchParams();

  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") {
      qs.set(k, String(v));
    }
  }
  qs.set("page", String(page));
  qs.set("limit", String(limit));

  const url = `${BASE}/v3/osu/beatmaps/search/v2?${qs.toString()}`;

  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Hinamizawa search failed: ${res.status} ${body}`);
  }

  return res.json() as Promise<SearchV2Response>;
}

export interface PaginatedSearchResult {
  beatmapsetIds: number[];
  totalCount: number;
  pages: number;
}

/**
 * Walk ALL pages for a given query and return every SetID found.
 * Used by the admin cache refresh to build the full list.
 *
 * Respects the API's pagination: starts at page 0 and increments until
 * we've collected total_pages worth of results.
 */
export async function fetchAllBeatmapsetIds(
  params: HinamizawaSearchParams,
  onProgress?: (fetched: number, total: number) => void
): Promise<PaginatedSearchResult> {
  const LIMIT = 100;
  const ids: number[] = [];

  // First page — also tells us the total
  const first = await fetchPage(params, 0, LIMIT);
  ids.push(...first.results.map((r) => r.SetID));
  onProgress?.(ids.length, first.total_count);

  const totalPages = first.total_pages;

  // Fetch remaining pages sequentially — sequential is the fast path per the docs
  // (serving page N caches the cursor for N+1)
  for (let page = 1; page < totalPages; page++) {
    const data = await fetchPage(params, page, LIMIT);
    ids.push(...data.results.map((r) => r.SetID));
    onProgress?.(ids.length, first.total_count);
  }

  return {
    beatmapsetIds: ids,
    totalCount: first.total_count,
    pages: totalPages,
  };
}

/**
 * Single-page search — used by GET /search for live (non-cached) fallback.
 */
export async function searchPage(
  params: HinamizawaSearchParams,
  page: number,
  limit: number
): Promise<SearchV2Response> {
  return fetchPage(params, page, limit);
}
