export type OnlineBeatmapDifficulty = {
  id: number;
  version: string;
  stars: number;
  mode: string;
  modeInt: number;
  keys: number | null;
};

export type OnlineBeatmapSet = {
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
  beatmaps: OnlineBeatmapDifficulty[];
};

export type MirrorSearchParams = {
  q?: string;
  mode?: "any" | "osu" | "taiko" | "fruits" | "mania";
  status?:
    | "any"
    | "ranked"
    | "qualified"
    | "loved"
    | "pending"
    | "graveyard";
  sort?:
    | "ranked_desc"
    | "ranked_asc"
    | "plays_desc"
    | "favourites_desc"
    | "difficulty_desc"
    | "title_asc";
  /** 0-based mirror page. */
  page?: number;
  /** Star-rating bounds (hinai / providers that support them). */
  minStars?: number;
  maxStars?: number;
  minBpm?: number;
  maxBpm?: number;
  minLength?: number;
  maxLength?: number;
  /** Mapper name filter (hinai `creator`). */
  creator?: string;
};

const MODE_INT: Record<Exclude<MirrorSearchParams["mode"], "any" | undefined>, number> =
  {
    osu: 0,
    taiko: 1,
    fruits: 2,
    mania: 3,
  };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asBool(value: unknown): boolean {
  return value === true;
}

function normalizeDifficulty(raw: unknown): OnlineBeatmapDifficulty | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asNumber(row.id);
  if (id == null || id <= 0) return null;
  const modeInt = asNumber(row.mode_int) ?? 0;
  const cs = asNumber(row.cs);
  return {
    id,
    version: asString(row.version) ?? "Unknown",
    stars: asNumber(row.difficulty_rating) ?? 0,
    mode: asString(row.mode) ?? "osu",
    modeInt,
    keys: modeInt === 3 && cs != null ? Math.round(cs) : null,
  };
}

export function normalizeOnlineBeatmapSet(
  raw: unknown,
): OnlineBeatmapSet | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asNumber(row.id);
  if (id == null || id <= 0) return null;

  const beatmaps = Array.isArray(row.beatmaps)
    ? row.beatmaps
        .map(normalizeDifficulty)
        .filter((b): b is OnlineBeatmapDifficulty => b != null)
        .sort((a, b) => a.stars - b.stars)
    : [];

  return {
    id,
    artist: asString(row.artist) ?? "Unknown",
    title: asString(row.title) ?? "Untitled",
    creator: asString(row.creator) ?? "Unknown",
    status: asString(row.status) ?? "unknown",
    bpm: asNumber(row.bpm),
    favouriteCount: asNumber(row.favourite_count) ?? 0,
    playCount: asNumber(row.play_count) ?? 0,
    hasVideo: asBool(row.video),
    rankedDate: asString(row.ranked_date),
    beatmaps,
  };
}

export function extractSearchBeatmapsets(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const row = asRecord(payload);
  if (!row) return [];
  if (Array.isArray(row.beatmapsets)) return row.beatmapsets;
  if (Array.isArray(row.data)) return row.data;
  if (Array.isArray(row.sets)) return row.sets;
  if (Array.isArray(row.results)) return row.results;
  return [];
}

/**
 * Extract the total catalogue count from a hinai v2 response.
 * The v2 endpoint (`/v3/osu/beatmaps/search/v2`) wraps results in an object
 * that includes `total_count` for locally-served queries (ranked/loved).
 * Returns null for v1 flat arrays or any response that doesn't carry the field.
 */
export function extractTotalCount(payload: unknown): number | null {
  const row = asRecord(payload);
  if (!row) return null;
  return asNumber(row.total_count);
}

export function buildNerinyanSearchUrl(params: MirrorSearchParams): string {
  const url = new URL("https://api.nerinyan.moe/search");
  const q = params.q?.trim();
  if (q) url.searchParams.set("q", q);
  if (params.mode && params.mode !== "any") {
    url.searchParams.set("m", String(MODE_INT[params.mode]));
  }
  if (params.status && params.status !== "any") {
    url.searchParams.set("s", params.status);
  }
  if (params.sort) url.searchParams.set("sort", params.sort);
  url.searchParams.set("page", String(Math.max(0, params.page ?? 0)));
  return url.toString();
}

export function buildOsuDirectSearchUrl(params: MirrorSearchParams): string {
  const url = new URL("https://osu.direct/api/v2/search");
  const q = params.q?.trim();
  if (q) url.searchParams.set("query", q);
  if (params.mode && params.mode !== "any") {
    url.searchParams.set("mode", String(MODE_INT[params.mode]));
  }
  if (params.status && params.status !== "any") {
    url.searchParams.set("status", params.status);
  }
  // osu.direct pages are typically 1-based.
  url.searchParams.set("page", String(Math.max(0, params.page ?? 0) + 1));
  return url.toString();
}

/**
 * v1 CheeseGull `RankedStatus` codes hinai documents for `/api/v1/hinai/search`.
 * `graveyard` has no documented numeric code on this endpoint, so it is left
 * unfiltered rather than guessed — see docs/mirror status mapping below.
 */
const HINAI_STATUS_CODE: Partial<
  Record<Exclude<MirrorSearchParams["status"], "any" | undefined>, number>
> = {
  pending: 0,
  ranked: 1,
  qualified: 3,
  loved: 4,
};

/** Page size requested from mirrors; keep in sync with MIRROR_PAGE_CAPACITY in searchOnline.ts. */
const HINAI_PAGE_SIZE = 100;

function setOptionalNumberParam(
  url: URL,
  key: string,
  value: number | undefined,
): void {
  if (value != null && Number.isFinite(value)) {
    url.searchParams.set(key, String(value));
  }
}

/**
 * hinai v2 advanced search — used when v1 cannot express the filter
 * (notably `graveyard`, which has no CheeseGull status code).
 * See https://mirror.hinamizawa.ai/docs/beatmap-search
 */
export function buildHinaiV2SearchUrl(params: MirrorSearchParams): string {
  const url = new URL(
    "https://mirror.hinamizawa.ai/v3/osu/beatmaps/search/v2",
  );
  const q = params.q?.trim();
  if (q) url.searchParams.set("query", q);
  if (params.mode && params.mode !== "any") {
    url.searchParams.set("mode", String(MODE_INT[params.mode]));
  }
  if (params.status && params.status !== "any") {
    url.searchParams.set("status", params.status);
  }
  if (params.sort) url.searchParams.set("sort", params.sort);
  const creator = params.creator?.trim();
  if (creator) url.searchParams.set("creator", creator);
  setOptionalNumberParam(url, "min_stars", params.minStars);
  setOptionalNumberParam(url, "max_stars", params.maxStars);
  setOptionalNumberParam(url, "min_bpm", params.minBpm);
  setOptionalNumberParam(url, "max_bpm", params.maxBpm);
  setOptionalNumberParam(url, "min_length", params.minLength);
  setOptionalNumberParam(url, "max_length", params.maxLength);
  url.searchParams.set("limit", String(HINAI_PAGE_SIZE));
  url.searchParams.set("page", String(Math.max(0, params.page ?? 0)));
  return url.toString();
}

export function buildHinaiSearchUrl(params: MirrorSearchParams): string {
  // Graveyard has no v1 RankedStatus code — use the advanced v2 endpoint.
  if (params.status === "graveyard") {
    return buildHinaiV2SearchUrl(params);
  }

  // Stable v1 contract (CheeseGull-compatible), see:
  // https://mirror.hinamizawa.ai/docs/beatmap-search
  const url = new URL("https://mirror.hinamizawa.ai/api/v1/hinai/search");
  const q = params.q?.trim();
  if (q) url.searchParams.set("query", q);
  if (params.mode && params.mode !== "any") {
    url.searchParams.set("mode", String(MODE_INT[params.mode]));
  }
  if (params.status && params.status !== "any") {
    const code = HINAI_STATUS_CODE[params.status];
    if (code != null) url.searchParams.set("status", String(code));
  }
  if (params.sort) url.searchParams.set("sort", params.sort);
  const creator = params.creator?.trim();
  if (creator) url.searchParams.set("creator", creator);
  setOptionalNumberParam(url, "min_stars", params.minStars);
  setOptionalNumberParam(url, "max_stars", params.maxStars);
  setOptionalNumberParam(url, "min_bpm", params.minBpm);
  setOptionalNumberParam(url, "max_bpm", params.maxBpm);
  setOptionalNumberParam(url, "min_length", params.minLength);
  setOptionalNumberParam(url, "max_length", params.maxLength);
  url.searchParams.set("amount", String(HINAI_PAGE_SIZE));
  const page = Math.max(0, params.page ?? 0);
  url.searchParams.set("offset", String(page * HINAI_PAGE_SIZE));
  return url.toString();
}

/**
 * hinai URL for count probes. Always uses v2 so ranked/loved responses include
 * `total_count` / `total_pages` (v1 returns a flat CheeseGull array).
 */
export function buildHinaiCountSearchUrl(params: MirrorSearchParams): string {
  return buildHinaiV2SearchUrl({ ...params, page: 0 });
}

export function buildMirrorSearchUrl(
  providerId: "nerinyan" | "osu.direct" | "hinai",
  params: MirrorSearchParams,
): string {
  if (providerId === "osu.direct") return buildOsuDirectSearchUrl(params);
  if (providerId === "hinai") return buildHinaiSearchUrl(params);
  return buildNerinyanSearchUrl(params);
}

/**
 * hinai's `/api/v1/hinai/search` speaks the CheeseGull dialect: PascalCase
 * fields, a numeric `RankedStatus`, and children nested under
 * `ChildrenBeatmaps` instead of `beatmaps`. Field names beyond the
 * documented example (Favourites/PlayCount/ApprovedDate) follow the
 * well-known CheeseGull schema bancho.py/kawata.py already parse; missing
 * fields degrade to the same safe defaults as the osu-style normalizer.
 */
const CHEESEGULL_STATUS: Record<number, string> = {
  0: "pending",
  1: "ranked",
  2: "approved",
  3: "qualified",
  4: "loved",
};

function normalizeCheeseGullDifficulty(
  raw: unknown,
): OnlineBeatmapDifficulty | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asNumber(row.BeatmapID);
  if (id == null || id <= 0) return null;
  const modeInt = asNumber(row.Mode) ?? 0;
  const cs = asNumber(row.CS);
  const modeName =
    (Object.keys(MODE_INT) as Array<keyof typeof MODE_INT>).find(
      (key) => MODE_INT[key] === modeInt,
    ) ?? "osu";
  return {
    id,
    version: asString(row.DiffName) ?? "Unknown",
    stars: asNumber(row.DifficultyRating) ?? 0,
    mode: modeName,
    modeInt,
    keys: modeInt === 3 && cs != null ? Math.round(cs) : null,
  };
}

export function normalizeCheeseGullBeatmapSet(
  raw: unknown,
): OnlineBeatmapSet | null {
  const row = asRecord(raw);
  if (!row) return null;
  const id = asNumber(row.SetID);
  if (id == null || id <= 0) return null;

  const beatmaps = Array.isArray(row.ChildrenBeatmaps)
    ? row.ChildrenBeatmaps
        .map(normalizeCheeseGullDifficulty)
        .filter((b): b is OnlineBeatmapDifficulty => b != null)
        .sort((a, b) => a.stars - b.stars)
    : [];

  const statusCode = asNumber(row.RankedStatus);

  return {
    id,
    artist: asString(row.Artist) ?? "Unknown",
    title: asString(row.Title) ?? "Untitled",
    creator: asString(row.Creator) ?? "Unknown",
    status: statusCode != null ? CHEESEGULL_STATUS[statusCode] ?? "unknown" : "unknown",
    bpm: asNumber(row.bpm ?? row.BPM),
    favouriteCount: asNumber(row.Favourites) ?? 0,
    playCount: asNumber(row.PlayCount) ?? 0,
    hasVideo: row.HasVideo === 1 || row.HasVideo === true,
    rankedDate: asString(row.ApprovedDate) ?? null,
    beatmaps,
  };
}

/** Provider-aware dispatcher — the one place that knows which mirror uses which wire shape. */
export function normalizeMirrorSearchResult(
  providerId: "nerinyan" | "osu.direct" | "hinai",
  raw: unknown,
): OnlineBeatmapSet | null {
  if (providerId === "hinai") {
    const row = asRecord(raw);
    // v1 CheeseGull uses SetID / ChildrenBeatmaps; v2 (graveyard) uses osu-style ids.
    if (row && ("SetID" in row || "ChildrenBeatmaps" in row)) {
      return normalizeCheeseGullBeatmapSet(raw);
    }
    return normalizeOnlineBeatmapSet(raw);
  }
  return normalizeOnlineBeatmapSet(raw);
}
