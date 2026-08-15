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

/** One difficulty kept from hinai search `beatmaps[]` for filtering / display. */
export interface SearchV2Difficulty {
  id: number;
  version: string;
  stars: number;
  mode: string;
  modeInt: number;
  /** Mania keys from `cs` when mode is mania. */
  keys: number | null;
  totalLength: number | null;
}

/**
 * One set from hinai `/v3/osu/beatmaps/search/v2`.
 * Enriched fields are best-effort from the search page (no `/s/{id}` N+1).
 */
export interface SearchV2Set {
  SetID: number;
  /** Mania keymodes present on embedded beatmaps (from `cs`), if any. */
  maniaKeys: number[];
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
  beatmaps: SearchV2Difficulty[];
}

/** Normalized page from hinai `/v3/osu/beatmaps/search/v2`. */
export interface SearchV2Response {
  results: SearchV2Set[];
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

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function maxLengthSeconds(
  beatmaps: Array<{ totalLength: number | null }>,
): number | null {
  let max: number | null = null;
  for (const b of beatmaps) {
    if (b.totalLength == null || !(b.totalLength > 0)) continue;
    max = max == null ? b.totalLength : Math.max(max, b.totalLength);
  }
  return max;
}

function parseDifficulty(
  raw: unknown,
  fallbackId: number,
): SearchV2Difficulty | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asFiniteNumber(row.id) ?? fallbackId;
  if (id <= 0) return null;
  const modeInt = asFiniteNumber(row.mode_int) ?? 0;
  const modeName = asString(row.mode)?.toLowerCase() ?? "osu";
  const cs = asFiniteNumber(row.cs);
  const isMania = modeInt === 3 || modeName === "mania";
  return {
    id,
    version: asString(row.version) ?? "Unknown",
    stars: asFiniteNumber(row.difficulty_rating) ?? 0,
    mode: asString(row.mode) ?? "osu",
    modeInt,
    keys: isMania && cs != null ? Math.round(cs) : null,
    totalLength: asFiniteNumber(row.total_length),
  };
}

/**
 * Mania keymodes from a search/set payload's `beatmaps` array.
 * Same rule as Download Maps: `mode_int === 3` (or mode name) and `Math.round(cs)`.
 */
export function maniaKeysFromBeatmaps(beatmaps: unknown): number[] {
  if (!Array.isArray(beatmaps)) return [];
  const keys = new Set<number>();
  for (const item of beatmaps) {
    const row = asRecord(item);
    if (!row) continue;
    const modeInt = asFiniteNumber(row.mode_int);
    const modeName =
      typeof row.mode === "string" ? row.mode.toLowerCase() : "";
    const isMania = modeInt === 3 || modeName === "mania";
    if (!isMania) continue;
    const cs = asFiniteNumber(row.cs);
    if (cs == null) continue;
    const k = Math.round(cs);
    if (k > 0 && k <= 18) keys.add(k);
  }
  return [...keys].sort((a, b) => a - b);
}

export function setHasManiaKeymode(
  maniaKeys: number[],
  keymode: number,
): boolean {
  return maniaKeys.includes(keymode);
}

function parseSearchV2Set(item: unknown): SearchV2Set | null {
  const set = asRecord(item);
  if (!set) return null;
  const id = asFiniteNumber(set.id) ?? asFiniteNumber(set.SetID);
  if (id == null || id <= 0) return null;

  const rawBeatmaps = Array.isArray(set.beatmaps) ? set.beatmaps : [];
  const beatmaps: SearchV2Difficulty[] = [];
  let i = 0;
  for (const raw of rawBeatmaps) {
    i += 1;
    const diff = parseDifficulty(raw, id * 1000 + i);
    if (diff) beatmaps.push(diff);
  }
  beatmaps.sort((a, b) => a.stars - b.stars);

  return {
    SetID: id,
    maniaKeys: maniaKeysFromBeatmaps(set.beatmaps),
    artist: asString(set.artist) ?? "",
    title: asString(set.title) ?? "",
    creator: asString(set.creator) ?? "",
    status: asString(set.status) ?? "",
    bpm: asFiniteNumber(set.bpm),
    favouriteCount:
      asFiniteNumber(set.favourite_count) ??
      asFiniteNumber(set.FavouriteCount) ??
      0,
    playCount:
      asFiniteNumber(set.play_count) ?? asFiniteNumber(set.PlayCount) ?? 0,
    hasVideo: set.video === true || set.HasVideo === true,
    rankedDate: asString(set.ranked_date) ?? asString(set.RankedDate),
    lengthSeconds: maxLengthSeconds(beatmaps),
    beatmaps,
  };
}

/**
 * Parse hinai v2 search JSON into a stable hub shape.
 * Live API returns `{ beatmapsets: [{ id, artist, title, beatmaps: […] }], … }`.
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

  const results: SearchV2Set[] = [];
  for (const item of rawSets) {
    const parsed = parseSearchV2Set(item);
    if (parsed) results.push(parsed);
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
  /** Unfiltered catalogue size from Hinamizawa (before optional keymode keep). */
  totalCount: number;
  pages: number;
}

export interface PaginatedStubResult {
  stubs: SearchV2Set[];
  /** Unfiltered catalogue size from Hinamizawa (before optional keymode keep). */
  totalCount: number;
  pages: number;
}

export type FetchAllBeatmapsetIdsOpts = {
  /** Keep only sets whose embedded search diffs include this mania keymode. */
  keymode?: number;
  onProgress?: (scraped: number, catalogueTotal: number, kept: number) => void;
};

async function crawlAllPages(
  params: HinamizawaSearchParams,
  opts: FetchAllBeatmapsetIdsOpts,
): Promise<PaginatedStubResult> {
  const keymode = opts.keymode;
  const LIMIT = 100;
  const stubs: SearchV2Set[] = [];
  const seen = new Set<number>();
  let scraped = 0;
  let pagesFetched = 0;

  const first = await fetchPage(params, 0, LIMIT);
  const catalogueTotal = first.total_count;
  const declaredPages = Math.max(
    first.total_pages,
    Math.ceil(Math.max(catalogueTotal, 1) / LIMIT),
  );

  function ingest(page: SearchV2Response) {
    pagesFetched += 1;
    scraped += page.results.length;
    for (const row of page.results) {
      if (seen.has(row.SetID)) continue;
      seen.add(row.SetID);
      if (keymode != null && !setHasManiaKeymode(row.maniaKeys, keymode)) {
        continue;
      }
      stubs.push(row);
    }
    opts.onProgress?.(scraped, catalogueTotal, stubs.length);
  }

  ingest(first);

  for (let page = 1; page < declaredPages + 8; page++) {
    if (catalogueTotal > 0 && scraped >= catalogueTotal) break;

    const data = await fetchPage(params, page, LIMIT);
    if (data.results.length === 0) break;
    ingest(data);
    if (data.results.length < LIMIT) break;
  }

  return {
    stubs,
    totalCount: catalogueTotal,
    pages: pagesFetched,
  };
}

/**
 * Walk ALL pages for a given query and return enriched stubs.
 * Used by the admin cache refresh to build the hub search index payload.
 */
export async function fetchAllBeatmapsetStubs(
  params: HinamizawaSearchParams,
  opts: FetchAllBeatmapsetIdsOpts = {},
): Promise<PaginatedStubResult> {
  return crawlAllPages(params, opts);
}

/**
 * Walk ALL pages for a given query and return SetIDs.
 * Used by the admin cache refresh to build the full list.
 *
 * When `keymode` is set, filter using embedded `beatmaps[].cs` on each search
 * page (same as Download Maps) — never N+1 `/s/{id}` (rate-limits truncating
 * the cache).
 */
export async function fetchAllBeatmapsetIds(
  params: HinamizawaSearchParams,
  onProgressOrOpts?:
    | ((fetched: number, total: number) => void)
    | FetchAllBeatmapsetIdsOpts,
): Promise<PaginatedSearchResult> {
  const opts: FetchAllBeatmapsetIdsOpts =
    typeof onProgressOrOpts === "function"
      ? {
          onProgress: (scraped, catalogueTotal, kept) =>
            onProgressOrOpts(kept > 0 ? kept : scraped, catalogueTotal),
        }
      : (onProgressOrOpts ?? {});
  const result = await crawlAllPages(params, opts);
  return {
    beatmapsetIds: result.stubs.map((s) => s.SetID),
    totalCount: result.totalCount,
    pages: result.pages,
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
