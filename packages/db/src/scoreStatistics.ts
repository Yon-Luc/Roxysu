export type ScoreJudgmentKey =
  | "perfect"
  | "great"
  | "good"
  | "ok"
  | "meh"
  | "miss";

export type ScoreJudgments = Record<ScoreJudgmentKey, number>;

export type ScoreJudgmentPresence = Record<ScoreJudgmentKey, boolean>;

export type ParsedScoreStatistics = {
  judgments: ScoreJudgments;
  /** True when that judgment's key was present, in any accepted style. */
  present: ScoreJudgmentPresence;
};

/**
 * Lazer stores HitResult keys three ways: lowercase (`perfect`), PascalCase
 * (`Perfect`), or the enum integer (`"6"`). Miss is `"1"`, not `"3"` (Ok).
 */
const ALIASES: Record<ScoreJudgmentKey, readonly string[]> = {
  perfect: ["perfect", "Perfect", "6"],
  great: ["great", "Great", "5"],
  good: ["good", "Good", "4"],
  ok: ["ok", "Ok", "3"],
  meh: ["meh", "Meh", "2"],
  miss: ["miss", "Miss", "1"],
};

const JUDGMENT_KEYS = Object.keys(ALIASES) as ScoreJudgmentKey[];

function readAlias(
  raw: Record<string, unknown>,
  aliases: readonly string[],
): { present: boolean; value: number } {
  for (const alias of aliases) {
    if (!(alias in raw)) continue;
    const value = raw[alias];
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n < 0) continue;
    return { present: true, value: Math.max(0, Math.floor(n)) };
  }
  return { present: false, value: 0 };
}

function parseObject(
  statistics: string | null | undefined,
): Record<string, unknown> | null {
  if (statistics == null || statistics === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(statistics);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return parsed as Record<string, unknown>;
}

/**
 * Parse lazer `scores.statistics`. Omitted judgments are 0 when any judgment
 * key is present (writers drop zero counts). Returns null when the object
 * has no judgment key at all.
 */
export function parseScoreStatisticsDetailed(
  statistics: string | null | undefined,
): ParsedScoreStatistics | null {
  const raw = parseObject(statistics);
  if (!raw) return null;
  const judgments = {} as ScoreJudgments;
  const present = {} as ScoreJudgmentPresence;
  for (const key of JUDGMENT_KEYS) {
    const read = readAlias(raw, ALIASES[key]);
    judgments[key] = read.value;
    present[key] = read.present;
  }
  if (!JUDGMENT_KEYS.some((key) => present[key])) return null;
  return { judgments, present };
}

export function parseScoreStatistics(
  statistics: string | null | undefined,
): ScoreJudgments | null {
  return parseScoreStatisticsDetailed(statistics)?.judgments ?? null;
}

/** JSON paths for one judgment, lowercase then PascalCase then integer. */
export function scoreJudgmentJsonPaths(key: ScoreJudgmentKey): string[] {
  return ALIASES[key].map((alias) =>
    /^\d+$/.test(alias) ? `$."${alias}"` : `$.${alias}`,
  );
}

/**
 * SQL expression for a miss count. Explicit miss keys win. When any other
 * judgment key is present and miss was omitted, the count is 0. Otherwise
 * NULL (no judgment statistics).
 */
export function scoreMissCountSql(columnSql: string): string {
  const missPaths = scoreJudgmentJsonPaths("miss");
  const missBranches = missPaths
    .map(
      (path) =>
        `WHEN json_extract(${columnSql}, '${path}') IS NOT NULL THEN CAST(json_extract(${columnSql}, '${path}') AS INTEGER)`,
    )
    .join("\n      ");
  const otherPresent = JUDGMENT_KEYS.filter((key) => key !== "miss")
    .flatMap((key) => scoreJudgmentJsonPaths(key))
    .map((path) => `json_extract(${columnSql}, '${path}') IS NOT NULL`)
    .join(" OR ");
  return `CASE
      ${missBranches}
      WHEN ${otherPresent} THEN 0
      ELSE NULL
    END`;
}
