
import { isShapeLabel, shapesForKeyCount } from "@roxysu/mania-difficulty";
import type { Db } from "@roxysu/db/types";
import { REWORK_ALGORITHM } from "../map-analysis/reworkEstimator";
import { PATTERN_ALGORITHM } from "@roxysu/mania-pattern-analysis";
import {
  DEFAULT_AXIS_THRESHOLDS,
  readAxisThresholdsSync,
  type AxisThresholds,
} from "../analytics/recommend/axisThresholds";
import type { PracticeCardRow } from "./execute";

export type PatternAxis = "all" | "rc" | "ln";
export type PatternKeymode = 4 | 7;

export type PatternSummaryItem = {
  pattern: string;
  label: string;
  /** Maps matching this pattern as dominant or secondary (same as `pattern:` search). */
  count: number;
  /** Maps where this pattern is the primary dominant label. */
  primaryCount: number;
  /** Maps included only because this pattern is secondary. */
  secondaryCount: number;
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

/** Skill labels plus retired Interlude names, so legacy rows still render. */
const PATTERN_DISPLAY: Record<string, string> = {
  speed: "Speed",
  jack: "Jack",
  coordination: "Coordination",
  technical: "Technical",
  release: "Release",
  jumpstream: "Jumpstream",
  handstream: "Handstream",
  chordjack: "Chordjack",
  bracket: "Bracket",
  chordstream: "Chordstream",
  stream: "Stream",
  delay: "Delay",
  trill: "Trill",
  jumptrill: "Jumptrill",
  mixed: "Mixed",
};

/** Skill labels, the same five for 4K and 7K. */
const SKILL_PATTERNS: readonly string[] = [
  "speed",
  "jack",
  "coordination",
  "technical",
  "release",
];

/** Chart shapes the classifier emits for that key count (shapesForKeyCount). */
const SHAPE_PATTERNS: Record<PatternKeymode, readonly string[]> = {
  4: shapesForKeyCount(4),
  7: shapesForKeyCount(7),
};

function patternsForKeymode(keymode: PatternKeymode): readonly string[] {
  return [...SKILL_PATTERNS, ...SHAPE_PATTERNS[keymode]];
}

function patternColumns(pattern: string): { primary: string; secondary: string } {
  return isShapeLabel(pattern)
    ? { primary: "pa.shape_pattern", secondary: "pa.secondary_shape" }
    : { primary: "pa.dominant_pattern", secondary: "pa.secondary_pattern" };
}

function baseFrom(_db: Db): string {
  return `
  FROM beatmaps b
  LEFT JOIN mastery m ON m.beatmap_id = b.id
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
  COALESCE(m.play_count, 0) AS playCount,
  m.best_accuracy AS bestAccuracy,
  m.best_pp AS bestPp,
  m.best_score AS bestScore,
  m.best_misses AS bestMisses,
  m.last_played_at AS lastPlayedAt,
  m.level AS masteryLevel,
  dr.est_diff AS reworkEstDiff,
  dr.sunny_star AS reworkStar,
  dr.ln_ratio AS reworkLnRatio
`;

function maniaKeymodeWhere(keymode: PatternKeymode): string {
  return `
  b.hidden = 0
  AND COALESCE(bs.delete_pending, 0) = 0
  AND b.ruleset_short_name = 'mania'
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

function axisSqlClause(
  axis: PatternAxis,
  params: SqlParam[],
  thresholds: AxisThresholds = DEFAULT_AXIS_THRESHOLDS,
): string | null {
  if (axis === "all") return null;
  if (axis === "ln") {
    params.push(thresholds.ln);
    params.push(thresholds.fln);
    return "dr.ln_ratio IS NOT NULL AND dr.ln_ratio >= ? AND dr.ln_ratio < ?";
  }
  params.push(thresholds.ln);
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
    reworkEstDiff: r.reworkEstDiff ?? null,
    reworkStar: r.reworkStar != null ? Number(r.reworkStar) : null,
    reworkLnRatio: r.reworkLnRatio != null ? Number(r.reworkLnRatio) : null,
    keyCount: r.keyCount != null ? Number(r.keyCount) : null,
  };
}

function buildPatternsForCounts(
  db: Db,
  axis: PatternAxis,
  keymode: PatternKeymode,
  countRows: Array<{
    pattern: string;
    count: number;
    primaryCount: number;
    secondaryCount: number;
  }>,
  samplesPerPattern: number,
  scopeWhere: string,
  axisFilter: string,
  axisParams: SqlParam[],
): PatternSummaryItem[] {
  const allowed = new Set(patternsForKeymode(keymode));
  const countByPattern = new Map(
    countRows
      .filter((r) => allowed.has(r.pattern))
      .map((r) => [r.pattern, r]),
  );
  const patterns: PatternSummaryItem[] = [];

  const fetchSamples = (pattern: string) => {
    const columns = patternColumns(pattern);
    return db.$client
      .query(
        `
        SELECT ${SELECT_COLS}
        ${baseFrom(db)}
        WHERE ${scopeWhere}
          AND pa.error IS NULL
          AND (
            ${columns.primary} = ?
            OR ${columns.secondary} = ?
          )
          ${axisFilter}
        ORDER BY
          CASE WHEN ${columns.primary} = ? THEN 0 ELSE 1 END,
          COALESCE(m.last_played_at, b.last_played) DESC NULLS LAST,
          b.id
        LIMIT ?
      `,
      )
      .all(
        REWORK_ALGORITHM,
        PATTERN_ALGORITHM,
        pattern,
        pattern,
        pattern,
        ...axisParams,
        samplesPerPattern,
      ) as PracticeCardRow[];
  };

  for (const pattern of patternsForKeymode(keymode)) {
    const row = countByPattern.get(pattern);
    const count = row?.count ?? 0;
    if (count <= 0) continue;
    patterns.push({
      pattern,
      label: PATTERN_DISPLAY[pattern] ?? pattern,
      count,
      primaryCount: row?.primaryCount ?? 0,
      secondaryCount: row?.secondaryCount ?? 0,
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
  const thresholds = readAxisThresholdsSync(db);

  const samplesPerPattern = Math.max(
    1,
    Math.min(8, Math.floor(opts.samplesPerPattern ?? 5)),
  );

  const axisParams: SqlParam[] = [];
  const axisClause = axisSqlClause(axis, axisParams, thresholds);
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
          .get(REWORK_ALGORITHM, ...axisParams) as { n: number });

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
    .get(REWORK_ALGORITHM, PATTERN_ALGORITHM, ...axisParams) as { n: number };

  const countRows = db.$client
    .query(
      `
      SELECT
        pattern,
        COUNT(*) AS n,
        SUM(CASE WHEN role = 'primary' THEN 1 ELSE 0 END) AS primary_n,
        SUM(CASE WHEN role = 'secondary' THEN 1 ELSE 0 END) AS secondary_n
      FROM (
        SELECT pa.dominant_pattern AS pattern, 'primary' AS role
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

        UNION ALL

        SELECT pa.secondary_pattern AS pattern, 'secondary' AS role
        FROM beatmaps b
        LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
        LEFT JOIN beatmap_dan_ratings dr
          ON dr.beatmap_id = b.id AND dr.algorithm = ?
        JOIN beatmap_pattern_analysis pa
          ON pa.beatmap_id = b.id AND pa.algorithm = ?
        WHERE ${scopeWhere}
          AND pa.secondary_pattern IS NOT NULL
          AND pa.secondary_pattern != pa.dominant_pattern
          AND pa.error IS NULL
          ${axisFilter}

        UNION ALL

        SELECT pa.shape_pattern AS pattern, 'primary' AS role
        FROM beatmaps b
        LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
        LEFT JOIN beatmap_dan_ratings dr
          ON dr.beatmap_id = b.id AND dr.algorithm = ?
        JOIN beatmap_pattern_analysis pa
          ON pa.beatmap_id = b.id AND pa.algorithm = ?
        WHERE ${scopeWhere}
          AND pa.shape_pattern IS NOT NULL
          AND pa.error IS NULL
          ${axisFilter}

        UNION ALL

        SELECT pa.secondary_shape AS pattern, 'secondary' AS role
        FROM beatmaps b
        LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
        LEFT JOIN beatmap_dan_ratings dr
          ON dr.beatmap_id = b.id AND dr.algorithm = ?
        JOIN beatmap_pattern_analysis pa
          ON pa.beatmap_id = b.id AND pa.algorithm = ?
        WHERE ${scopeWhere}
          AND pa.secondary_shape IS NOT NULL
          AND pa.secondary_shape != pa.shape_pattern
          AND pa.error IS NULL
          ${axisFilter}
      )
      GROUP BY pattern
    `,
    )
    .all(
      REWORK_ALGORITHM,
      PATTERN_ALGORITHM,
      ...axisParams,
      REWORK_ALGORITHM,
      PATTERN_ALGORITHM,
      ...axisParams,
      REWORK_ALGORITHM,
      PATTERN_ALGORITHM,
      ...axisParams,
      REWORK_ALGORITHM,
      PATTERN_ALGORITHM,
      ...axisParams,
    ) as Array<{
    pattern: string;
    n: number;
    primary_n: number;
    secondary_n: number;
  }>;

  const normalizedCounts = countRows.map((r) => ({
    pattern: r.pattern,
    count: Number(r.n ?? 0),
    primaryCount: Number(r.primary_n ?? 0),
    secondaryCount: Number(r.secondary_n ?? 0),
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
