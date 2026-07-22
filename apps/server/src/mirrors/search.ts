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
  return [];
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

export function buildMirrorSearchUrl(
  providerId: "nerinyan" | "osu.direct",
  params: MirrorSearchParams,
): string {
  return providerId === "osu.direct"
    ? buildOsuDirectSearchUrl(params)
    : buildNerinyanSearchUrl(params);
}
