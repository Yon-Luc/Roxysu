const UA = "roxysu-hub/0.1 (+https://github.com/Yon-Luc/Roxysu)";
const INFO_TIMEOUT_MS = 12_000;
const FETCH_CONCURRENCY = 8;

export type HubRuleset = "osu" | "taiko" | "fruits" | "mania";

export type CollectionPlayStats = {
  starsMin: number | null;
  starsMax: number | null;
  dominantMode: HubRuleset | null;
  dominantKeys: number | null;
};

export type DiffSample = {
  mode: HubRuleset;
  stars: number;
  keys: number | null;
};

const MODE_FROM_INT: Record<number, HubRuleset> = {
  0: "osu",
  1: "taiko",
  2: "fruits",
  3: "mania",
};

const MODE_FROM_NAME: Record<string, HubRuleset> = {
  osu: "osu",
  taiko: "taiko",
  fruits: "fruits",
  catch: "fruits",
  mania: "mania",
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function parseMode(row: Record<string, unknown>): HubRuleset {
  const modeInt = asNumber(row.mode_int);
  if (modeInt != null && MODE_FROM_INT[modeInt]) return MODE_FROM_INT[modeInt]!;
  const modeName = typeof row.mode === "string" ? row.mode.toLowerCase() : "";
  return MODE_FROM_NAME[modeName] ?? "osu";
}

/** Aggregate difficulty samples into collection-level play stats. */
export function aggregateCollectionStats(
  diffs: DiffSample[],
): CollectionPlayStats {
  if (diffs.length === 0) {
    return {
      starsMin: null,
      starsMax: null,
      dominantMode: null,
      dominantKeys: null,
    };
  }

  let starsMin: number | null = null;
  let starsMax: number | null = null;
  const modeCounts = new Map<HubRuleset, number>();
  const keyCounts = new Map<number, number>();

  for (const d of diffs) {
    if (!(d.stars > 0)) continue;
    starsMin = starsMin == null ? d.stars : Math.min(starsMin, d.stars);
    starsMax = starsMax == null ? d.stars : Math.max(starsMax, d.stars);
    modeCounts.set(d.mode, (modeCounts.get(d.mode) ?? 0) + 1);
    if (d.mode === "mania" && d.keys != null && d.keys > 0) {
      keyCounts.set(d.keys, (keyCounts.get(d.keys) ?? 0) + 1);
    }
  }

  let dominantMode: HubRuleset | null = null;
  let bestModeCount = 0;
  for (const [mode, count] of modeCounts) {
    if (count > bestModeCount) {
      dominantMode = mode;
      bestModeCount = count;
    }
  }

  let dominantKeys: number | null = null;
  if (dominantMode === "mania" && keyCounts.size > 0) {
    let bestKeyCount = 0;
    for (const [keys, count] of keyCounts) {
      if (count > bestKeyCount) {
        dominantKeys = keys;
        bestKeyCount = count;
      }
    }
  }

  return {
    starsMin,
    starsMax,
    dominantMode,
    dominantKeys,
  };
}

function diffsFromHinaiPayload(payload: unknown): DiffSample[] {
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  const beatmaps = Array.isArray(root.beatmaps) ? root.beatmaps : [];
  const out: DiffSample[] = [];
  for (const raw of beatmaps) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const stars =
      asNumber(row.difficulty_rating) ?? asNumber(row.difficultyrating);
    if (stars == null || !(stars > 0)) continue;
    const mode = parseMode(row);
    const cs = asNumber(row.cs);
    out.push({
      mode,
      stars,
      keys: mode === "mania" && cs != null ? Math.round(cs) : null,
    });
  }
  return out;
}

async function fetchHinaiSetDiffs(setId: number): Promise<DiffSample[]> {
  if (!Number.isSafeInteger(setId) || setId <= 0) return [];
  try {
    const res = await fetch(
      `https://mirror.hinamizawa.ai/v3/osu/beatmaps/s/${setId}`,
      {
        headers: { accept: "application/json", "user-agent": UA },
        signal: AbortSignal.timeout(INFO_TIMEOUT_MS),
      },
    );
    if (!res.ok) return [];
    return diffsFromHinaiPayload(await res.json());
  } catch {
    return [];
  }
}

/** Resolve collection stats from beatmapset IDs via hinai beatmap-info. */
export async function computeCollectionStatsFromSetIds(
  setIds: number[],
): Promise<CollectionPlayStats> {
  const unique = [
    ...new Set(setIds.filter((id) => Number.isSafeInteger(id) && id > 0)),
  ];
  const diffs: DiffSample[] = [];
  for (const batch of chunk(unique, FETCH_CONCURRENCY * 2)) {
    const parts = await mapPool(batch, FETCH_CONCURRENCY, fetchHinaiSetDiffs);
    for (const list of parts) diffs.push(...list);
  }
  return aggregateCollectionStats(diffs);
}

export function isHubRuleset(value: string): value is HubRuleset {
  return (
    value === "osu" ||
    value === "taiko" ||
    value === "fruits" ||
    value === "mania"
  );
}
