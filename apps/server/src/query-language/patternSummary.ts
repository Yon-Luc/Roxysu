
import type { Db } from "@roxysu/db/types";
import { LN_DAN_RATIO_THRESHOLD } from "../map-analysis/estDiff";
import { backfillSunnyDanSync, SUNNY_ALGORITHM } from "../map-analysis/computeSunnyDan";
import { PATTERN_ALGORITHM } from "@roxysu/mania-pattern-analysis";
import {
  backfillPatternAnalysisSync,
  PATTERN_QUERY_BACKFILL_LIMIT,
} from "../map-analysis/computePatternAnalysis";
import {
  resolveScoresGamemodeSync,
  scoresGamemodeSqlLiteral,
} from "../analytics/scoreGamemode";
import {
  resolveScoresUsernamesSync,
  scoresUsernameSqlLiteral,
} from "../analytics/scoreUsername";
import type { PracticeCardRow } from "./execute";

export type PatternAxis = "all" | "rc" | "ln";
export type PatternKeymode = 4 | 7;

export type PatternSummaryItem = {
  pattern: string;
  label: string;
  count: number;
  /** Ready-made practice query for this pattern group. */
  query: string;
  samples: PracticeCardRow[];
};

export type PatternSummary = {
  axis: PatternAxis;
  keymode: PatternKeymode;
  totalMania: number;
  /** @deprecated Use totalMania */
  total7k: number;
  /** Maps in the selected keymode (+ RC/LN axis when axis != all). */
  axisTotalMania: number;
  /** @deprecated Use axisTotalMania */
  axisTotal7k: number;
  analyzed: number;
  remaining: number;
  patterns: PatternSummaryItem[];
};

const PATTERN_DISPLAY: Record<string, string> = {
  jack: "Jack",
  jumpstream: "Jumpstream",
  chordjack: "Chordjack",
  bracket: "Bracket",
  chordstream: "Chordstream",
  stream: "Stream",
  delay: "Delay",
  mixed: "Mixed",
};

/** Interlude labels shown for 4K (hide 7K-specific families). */
const PATTERNS_4K = [
  "jack",
  "chordjack",
  "jumpstream",
  "stream",
  "mixed",
] as const;

/** Interlude labels shown for 7K (hide 4K-specific families). */
const PATTERNS_7K = [
  "jack",
  "chordjack",
  "delay",
  "chordstream",
  "bracket",
  "mixed",
] as const;

function patternsForKeymode(keymode: PatternKeymode): readonly string[] {
  return keymode === 4 ? PATTERNS_4K : PATTERNS_7K;
}

function baseFrom(db: Db): string {
  const userFilter = scoresUsernameSqlLiteral(
    resolveScoresUsernamesSync(db),
    "user_username",
  );
  const modeFilter = scoresGamemodeSqlLiteral(
    resolveScoresGamemodeSync(db),
    "ruleset_short_name",
  );
  return `
  FROM beatmaps b
  LEFT JOIN mastery m ON m.beatmap_id = b.id
  LEFT JOIN (
    SELECT
      beatmap_id,
      COUNT(*) AS play_count,
      MAX(accuracy) AS best_accuracy,
      MAX(pp) AS best_pp,
      MAX(total_score) AS best_score,
      MIN(
        CASE
          WHEN statistics IS NOT NULL
          THEN COALESCE(json_extract(statistics, '$.miss'), 0)
        END
      ) AS best_misses,
      MAX(played_at) AS last_played_at
    FROM scores
    WHERE delete_pending = 0 AND beatmap_id IS NOT NULL
      ${userFilter}
      ${modeFilter}
    GROUP BY beatmap_id
  ) ps ON ps.beatmap_id = b.id
  LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
  LEFT JOIN beatmap_dan_ratings dr
    ON dr.beatmap_id = b.id AND dr.algorithm = ?
  LEFT JOIN beatmap_pattern_analysis pa
    ON pa.beatmap_id = b.id AND pa.algorithm = ?
`;
}

const SELECT_COLS = `
  b.id AS id,
  b.title AS title,
  b.artist AS artist,
  b.difficulty_name AS difficultyName,
  b.star_rating AS starRating,
  b.bpm AS bpm,
  b.ruleset_short_name AS rulesetShortName,
  b.circle_size AS keyCount,
  b.mapper_username AS mapperUsername,
  CASE WHEN b.online_id > 0 THEN b.online_id ELSE NULL END AS onlineId,
  CASE WHEN bs.online_id > 0 THEN bs.online_id ELSE NULL END AS setOnlineId,
  b.background_file_hash AS backgroundFileHash,
  COALESCE(ps.play_count, 0) AS playCount,
  ps.best_accuracy AS bestAccuracy,
  ps.best_pp AS bestPp,
  ps.best_score AS bestScore,
  ps.best_misses AS bestMisses,
  ps.last_played_at AS lastPlayedAt,
  m.level AS masteryLevel,
  dr.est_diff AS sunnyEstDiff,
  dr.sunny_star AS sunnyStar
`;

function maniaKeymodeWhere(keymode: PatternKeymode): string {
  return `
  b.hidden = 0
  AND COALESCE(bs.delete_pending, 0) = 0
  AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
  AND ROUND(COALESCE(b.circle_size, 0)) = ${keymode}
`;
}

function parseAxis(value: string | undefined): PatternAxis {
  if (value === "rc" || value === "ln") return value;
  return "all";
}

function parseKeymode(value: string | number | undefined): PatternKeymode {
  const n = typeof value === "number" ? value : Number(value);
  return n === 4 ? 4 : 7;
}

type SqlParam = string | number | boolean | null;

function axisSqlClause(axis: PatternAxis, params: SqlParam[]): string | null {
  if (axis === "all") return null;
  params.push(LN_DAN_RATIO_THRESHOLD);
  if (axis === "ln") {
    return "dr.ln_ratio IS NOT NULL AND dr.ln_ratio >= ?";
  }
  return "dr.ln_ratio IS NOT NULL AND dr.ln_ratio < ?";
}

function patternQuery(
  pattern: string,
  axis: PatternAxis,
  keymode: PatternKeymode,
): string {
  if (axis === "rc") return `key=${keymode} axis:rc pattern:${pattern}`;
  if (axis === "ln") return `key=${keymode} axis:ln pattern:${pattern}`;
  return `key=${keymode} pattern:${pattern}`;
}

function mapSampleRow(r: PracticeCardRow): PracticeCardRow {
  return {
    ...r,
    onlineId: r.onlineId != null ? Number(r.onlineId) : null,
    setOnlineId: r.setOnlineId != null ? Number(r.setOnlineId) : null,
    playCount: Number(r.playCount ?? 0),
    bestScore: r.bestScore != null ? Number(r.bestScore) : null,
    bestMisses: r.bestMisses != null ? Number(r.bestMisses) : null,
    masteryLevel: r.masteryLevel != null ? Number(r.masteryLevel) : null,
    sunnyEstDiff: r.sunnyEstDiff ?? null,
    sunnyStar: r.sunnyStar != null ? Number(r.sunnyStar) : null,
    keyCount: r.keyCount != null ? Number(r.keyCount) : null,
  };
}

function buildPatternsForCounts(
  db: Db,
  axis: PatternAxis,
  keymode: PatternKeymode,
  countRows: Array<{ pattern: string; count: number }>,
  samplesPerPattern: number,
  scopeWhere: string,
  axisFilter: string,
  axisParams: SqlParam[],
): PatternSummaryItem[] {
  const allowed = new Set(patternsForKeymode(keymode));
  const countByPattern = new Map(
    countRows
      .filter((r) => allowed.has(r.pattern))
      .map((r) => [r.pattern, Number(r.count)]),
  );
  const patterns: PatternSummaryItem[] = [];

  const fetchSamples = (pattern: string) =>
    db.$client
      .query(
        `
        SELECT ${SELECT_COLS}
        ${baseFrom(db)}
        WHERE ${scopeWhere}
          AND pa.dominant_pattern = ?
          AND pa.error IS NULL
          ${axisFilter}
        ORDER BY COALESCE(ps.last_played_at, b.last_played) DESC NULLS LAST, b.id
        LIMIT ?
      `,
      )
      .all(
        SUNNY_ALGORITHM,
        PATTERN_ALGORITHM,
        pattern,
        ...axisParams,
        samplesPerPattern,
      ) as PracticeCardRow[];

  for (const pattern of patternsForKeymode(keymode)) {
    const count = countByPattern.get(pattern) ?? 0;
    if (count <= 0) continue;
    patterns.push({
      pattern,
      label: PATTERN_DISPLAY[pattern] ?? pattern,
      count,
      query: patternQuery(pattern, axis, keymode),
      samples: fetchSamples(pattern).map(mapSampleRow),
    });
  }

  patterns.sort((a, b) => {
    if (a.pattern === "mixed") return 1;
    if (b.pattern === "mixed") return -1;
    return b.count - a.count;
  });

  return patterns;
}

/** Mania pattern overview for the practice browser modal. */
export function practicePatternSummary(
  db: Db,
  opts: {
    samplesPerPattern?: number;
    axis?: string;
    keymode?: string | number;
  } = {},
): PatternSummary {
  const axis = parseAxis(opts.axis);
  const keymode = parseKeymode(opts.keymode);
  const scopeWhere = maniaKeymodeWhere(keymode);

  backfillPatternAnalysisSync(db, { limit: PATTERN_QUERY_BACKFILL_LIMIT });
  if (axis !== "all") {
    backfillSunnyDanSync(db, { limit: PATTERN_QUERY_BACKFILL_LIMIT });
  }

  const samplesPerPattern = Math.max(
    1,
    Math.min(8, Math.floor(opts.samplesPerPattern ?? 5)),
  );

  const axisParams: SqlParam[] = [];
  const axisClause = axisSqlClause(axis, axisParams);
  const axisFilter = axisClause ? `AND ${axisClause}` : "";

  const totalRow = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      WHERE ${scopeWhere}
    `,
    )
    .get() as { n: number };

  const axisTotalRow =
    axis === "all"
      ? null
      : (db.$client
          .query(
            `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE ${scopeWhere}
        ${axisFilter}
    `,
          )
          .get(SUNNY_ALGORITHM, ...axisParams) as { n: number });

  const analyzedRow = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      JOIN beatmap_pattern_analysis pa
        ON pa.beatmap_id = b.id AND pa.algorithm = ?
      WHERE ${scopeWhere}
        AND pa.dominant_pattern IS NOT NULL
        AND pa.error IS NULL
        ${axisFilter}
    `,
    )
    .get(SUNNY_ALGORITHM, PATTERN_ALGORITHM, ...axisParams) as { n: number };

  const countRows = db.$client
    .query(
      `
      SELECT pa.dominant_pattern AS pattern, COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      JOIN beatmap_pattern_analysis pa
        ON pa.beatmap_id = b.id AND pa.algorithm = ?
      WHERE ${scopeWhere}
        AND pa.dominant_pattern IS NOT NULL
        AND pa.error IS NULL
        ${axisFilter}
      GROUP BY pa.dominant_pattern
    `,
    )
    .all(SUNNY_ALGORITHM, PATTERN_ALGORITHM, ...axisParams) as Array<{
    pattern: string;
    n: number;
  }>;

  const normalizedCounts = countRows.map((r) => ({
    pattern: r.pattern,
    count: Number(r.n ?? 0),
  }));

  const patterns = buildPatternsForCounts(
    db,
    axis,
    keymode,
    normalizedCounts,
    samplesPerPattern,
    scopeWhere,
    axisFilter,
    axisParams,
  );

  const totalMania = Number(totalRow?.n ?? 0);
  const analyzed = Number(analyzedRow?.n ?? 0);
  const axisTotalMania =
    axis === "all" ? totalMania : Number(axisTotalRow?.n ?? 0);

  return {
    axis,
    keymode,
    totalMania,
    total7k: totalMania,
    axisTotalMania,
    axisTotal7k: axisTotalMania,
    analyzed,
    remaining: Math.max(0, axisTotalMania - analyzed),
    patterns,
  };
}

export { patternQuery };
