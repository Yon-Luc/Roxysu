const BASE = "https://mirror.hinamizawa.ai";
const UA = "roxysu-hub/0.1 (+https://github.com/Yon-Luc/Roxysu)";

export interface HinamizawaSearchParams {
  query?: string;
  mode?: number; // 0 osu, 1 taiko, 2 catch, 3 mania
  status?: string; // ranked, loved, pending, graveyard
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

/** Normalized page from hinai `/v3/osu/beatmaps/search/v2`. */
export interface SearchV2Response {
  results: Array<{ SetID: number }>;
  total_count: number;
  total_pages: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Parse hinai v2 search JSON into a stable hub shape.
 * Live API returns `{ beatmapsets: [{ id }], total_count, total_pages }`
 * (osu!-style), not CheeseGull `{ results: [{ SetID }] }`.
 */
export function parseSearchV2Response(payload: unknown): SearchV2Response {
  const row = asRecord(payload);
  if (!row) {
    throw new Error("Hinamizawa search returned a non-object payload");
  }

  const rawSets =
    (Array.isArray(row.beatmapsets) && row.beatmapsets) ||
    (Array.isArray(row.results) && row.results) ||
    (Array.isArray(row.data) && row.data) ||
    null;

  if (!rawSets) {
    throw new Error(
      `Hinamizawa search missing beatmapsets (keys: ${Object.keys(row).join(", ")})`,
    );
  }

  const results: Array<{ SetID: number }> = [];
  for (const item of rawSets) {
    const set = asRecord(item);
    if (!set) continue;
    const id = asFiniteNumber(set.id) ?? asFiniteNumber(set.SetID);
    if (id == null || id <= 0) continue;
    results.push({ SetID: id });
  }

  const total_count =
    asFiniteNumber(row.total_count) ??
    asFiniteNumber(row.total) ??
    results.length;
  const total_pages =
    asFiniteNumber(row.total_pages) ??
    Math.max(1, Math.ceil(total_count / Math.max(1, results.length || 100)));

  return {
    results,
    total_count,
    total_pages,
  };
}

/**
 * Fetch one page from the v2 search endpoint.
 * v2 uses string status values (ranked, loved…) and page/limit pagination.
 * It is answered from the local tantivy index (~3ms) when status is ranked or loved.
 */
async function fetchPage(
  params: HinamizawaSearchParams,
  page: number,
  limit = 100,
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

  const json: unknown = await res.json();
  return parseSearchV2Response(json);
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
  onProgress?: (fetched: number, total: number) => void,
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
  limit: number,
): Promise<SearchV2Response> {
  return fetchPage(params, page, limit);
}
