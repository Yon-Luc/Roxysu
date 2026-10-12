export const OSU_API_VERSION = "20220705";
export const RANKED_BEST_PAGE = 100;
export const SCORE_PULL_FRESH_MS = 24 * 60 * 60 * 1000;

export const SCORE_RULESETS = ["osu", "taiko", "fruits", "mania"] as const;
export type ScoreRuleset = (typeof SCORE_RULESETS)[number];

export function isScoreRuleset(value: string): value is ScoreRuleset {
  return (SCORE_RULESETS as readonly string[]).includes(value);
}

/** Compact ranked best stored on the Hub and returned to the client app. */
export type RankedBest = {
  id: number;
  legacyScoreId: number | null;
  beatmapId: number;
  beatmapsetId: number | null;
  checksum: string | null;
  accuracy: number;
  pp: number | null;
  maxCombo: number;
  totalScore: number;
  totalScoreWithoutMods: number;
  legacyTotalScore: number | null;
  rank: string;
  modsJson: string;
  statistics: Record<string, number>;
  maximumStatistics: Record<string, number> | null;
  endedAt: string;
  userId: number;
  username: string;
  isLegacy: boolean;
};

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function int(value: unknown, fallback = 0): number {
  const n = num(value);
  if (n == null) return fallback;
  return Math.trunc(n);
}

function statsObject(value: unknown): Record<string, number> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = num(raw);
    if (n != null && n > 0) out[key] = Math.trunc(n);
  }
  return out;
}

const STABLE_TO_LAZER: Record<string, string> = {
  count_geki: "perfect",
  count_300: "great",
  count_katu: "good",
  count_100: "ok",
  count_50: "meh",
  count_miss: "miss",
};

export function lazerStatistics(raw: Record<string, number>): Record<string, number> {
  const named: Record<string, number> = {};
  let usedStable = false;
  for (const [key, value] of Object.entries(raw)) {
    const mapped = STABLE_TO_LAZER[key];
    if (mapped) {
      named[mapped] = (named[mapped] ?? 0) + value;
      usedStable = true;
      continue;
    }
    if (!key.startsWith("count_")) named[key.toLowerCase()] = value;
  }
  if (usedStable || Object.keys(named).length > 0) return named;
  return raw;
}

function modsJson(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) return "[]";
  const mods = raw.map((entry) => {
    if (typeof entry === "string") return { acronym: entry.toUpperCase() };
    if (entry && typeof entry === "object" && "acronym" in entry) {
      const obj = entry as { acronym?: unknown; settings?: unknown };
      const acronym = String(obj.acronym ?? "").toUpperCase();
      if (
        obj.settings &&
        typeof obj.settings === "object" &&
        !Array.isArray(obj.settings)
      ) {
        return { acronym, settings: obj.settings };
      }
      return { acronym };
    }
    return null;
  });
  return JSON.stringify(mods.filter((m) => m && m.acronym));
}

export function normalizeRankedBest(raw: unknown): RankedBest | null {
  if (raw == null || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const id = int(row.id, 0);
  if (id <= 0) return null;

  const beatmap = row.beatmap as Record<string, unknown> | undefined;
  const beatmapset = row.beatmapset as Record<string, unknown> | undefined;
  const beatmapId = int(row.beatmap_id ?? beatmap?.id, 0);
  if (beatmapId <= 0) return null;

  const user = row.user as Record<string, unknown> | undefined;
  const endedRaw = row.ended_at ?? row.created_at;
  const endedAt =
    typeof endedRaw === "string" && endedRaw
      ? endedRaw
      : new Date(0).toISOString();

  const newShape =
    "total_score" in row || "ended_at" in row || "legacy_score_id" in row;
  const legacyScoreId = num(row.legacy_score_id);
  const totalScore = int(newShape ? row.total_score : row.score, 0);
  const legacyTotal = num(row.legacy_total_score);
  const statistics = lazerStatistics(statsObject(row.statistics));
  const maximum = statsObject(row.maximum_statistics);

  return {
    id,
    legacyScoreId: legacyScoreId != null && legacyScoreId > 0 ? Math.trunc(legacyScoreId) : null,
    beatmapId,
    beatmapsetId: int(beatmap?.beatmapset_id ?? beatmapset?.id, 0) || null,
    checksum:
      typeof beatmap?.checksum === "string" && beatmap.checksum
        ? beatmap.checksum.toLowerCase()
        : null,
    accuracy: num(row.accuracy) ?? 0,
    pp: num(row.pp),
    maxCombo: int(row.max_combo, 0),
    totalScore,
    totalScoreWithoutMods: int(row.total_score_without_mods, totalScore),
    legacyTotalScore:
      legacyTotal != null
        ? Math.trunc(legacyTotal)
        : newShape
          ? null
          : totalScore,
    rank: typeof row.rank === "string" ? row.rank : "",
    modsJson: modsJson(row.mods),
    statistics,
    maximumStatistics: Object.keys(maximum).length > 0 ? lazerStatistics(maximum) : null,
    endedAt,
    userId: int(row.user_id ?? user?.id, 0),
    username:
      typeof user?.username === "string"
        ? user.username
        : typeof row.username === "string"
          ? row.username
          : "",
    isLegacy: !newShape || (legacyScoreId != null && legacyScoreId > 0 && totalScore === 0),
  };
}
