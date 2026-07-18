import type { Db } from "@roxysu/db/client.bun";
import { parseQuery } from "./parse";
import { compileQuery } from "./compile";
import type { AstNode } from "./ast";

export type PracticeCardRow = {
  id: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  starRating: number;
  bpm: number;
  rulesetShortName: string | null;
  mapperUsername: string | null;
  playCount: number;
  bestAccuracy: number | null;
  bestPp: number | null;
  bestScore: number | null;
  bestMisses: number | null;
  lastPlayedAt: number | null;
  masteryLevel: number | null;
};

export type PracticeSortBy =
  | "lastPlayed"
  | "accuracy"
  | "misses"
  | "score"
  | "pp"
  | "mastery"
  | "stars";

export type PracticeSortDir = "asc" | "desc";

export type PracticeMetric = "accuracy" | "misses" | "score";

export type DistributionBin = {
  key: string;
  label: string;
  count: number;
};

type SqlBinding = string | number | bigint | boolean | null;

const BASE_FROM = `
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
    GROUP BY beatmap_id
  ) ps ON ps.beatmap_id = b.id
  LEFT JOIN (
    SELECT s.beatmap_id, MAX(sm.retry_index) AS max_retry
    FROM scores s
    JOIN score_metrics sm ON sm.score_id = s.id
    WHERE s.delete_pending = 0 AND s.beatmap_id IS NOT NULL
    GROUP BY s.beatmap_id
  ) rs ON rs.beatmap_id = b.id
  LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
`;

const SELECT_COLS = `
  b.id AS id,
  b.title AS title,
  b.artist AS artist,
  b.difficulty_name AS difficultyName,
  b.star_rating AS starRating,
  b.bpm AS bpm,
  b.ruleset_short_name AS rulesetShortName,
  b.mapper_username AS mapperUsername,
  COALESCE(ps.play_count, 0) AS playCount,
  ps.best_accuracy AS bestAccuracy,
  ps.best_pp AS bestPp,
  ps.best_score AS bestScore,
  ps.best_misses AS bestMisses,
  ps.last_played_at AS lastPlayedAt,
  m.level AS masteryLevel
`;

function baseWhere(extra: string): string {
  return `WHERE b.hidden = 0 AND COALESCE(bs.delete_pending, 0) = 0 AND (${extra})`;
}

function asBindings(params: unknown[]): SqlBinding[] {
  return params as SqlBinding[];
}

function orderBySql(sortBy: PracticeSortBy, sortDir: PracticeSortDir): string {
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  // Keep unplayed after played when sorting by score-derived metrics so
  // "lowest accuracy first" surfaces weak plays instead of empty maps.
  const playedFirst = `CASE WHEN ps.play_count IS NULL OR ps.play_count = 0 THEN 1 ELSE 0 END ASC`;
  switch (sortBy) {
    case "accuracy":
      return `${playedFirst}, ps.best_accuracy ${dir} NULLS LAST, b.id`;
    case "misses":
      return `${playedFirst}, ps.best_misses ${dir} NULLS LAST, b.id`;
    case "score":
      return `${playedFirst}, ps.best_score ${dir} NULLS LAST, b.id`;
    case "pp":
      return `${playedFirst}, ps.best_pp ${dir} NULLS LAST, b.id`;
    case "mastery":
      return `COALESCE(m.level, -1) ${dir}, b.id`;
    case "stars":
      return `b.star_rating ${dir}, b.id`;
    case "lastPlayed":
    default:
      return `COALESCE(ps.last_played_at, b.last_played) ${dir} NULLS LAST, b.id`;
  }
}

function accuracyBucketExpr(): string {
  return `
    CASE
      WHEN ps.best_accuracy IS NULL THEN 'unplayed'
      WHEN ps.best_accuracy < 0.1 THEN '0-10'
      WHEN ps.best_accuracy < 0.2 THEN '10-20'
      WHEN ps.best_accuracy < 0.3 THEN '20-30'
      WHEN ps.best_accuracy < 0.4 THEN '30-40'
      WHEN ps.best_accuracy < 0.5 THEN '40-50'
      WHEN ps.best_accuracy < 0.6 THEN '50-60'
      WHEN ps.best_accuracy < 0.7 THEN '60-70'
      WHEN ps.best_accuracy < 0.8 THEN '70-80'
      WHEN ps.best_accuracy < 0.9 THEN '80-90'
      ELSE '90-100'
    END
  `;
}

function missesBucketExpr(): string {
  return `
    CASE
      WHEN ps.best_misses IS NULL THEN 'unplayed'
      WHEN ps.best_misses = 0 THEN '0'
      WHEN ps.best_misses = 1 THEN '1'
      WHEN ps.best_misses <= 5 THEN '2-5'
      WHEN ps.best_misses <= 10 THEN '6-10'
      WHEN ps.best_misses <= 25 THEN '11-25'
      WHEN ps.best_misses <= 50 THEN '26-50'
      ELSE '51+'
    END
  `;
}

function scoreBucketExpr(): string {
  return `
    CASE
      WHEN ps.best_score IS NULL THEN 'unplayed'
      WHEN ps.best_score < 100000 THEN '0-100k'
      WHEN ps.best_score < 200000 THEN '100-200k'
      WHEN ps.best_score < 300000 THEN '200-300k'
      WHEN ps.best_score < 400000 THEN '300-400k'
      WHEN ps.best_score < 500000 THEN '400-500k'
      WHEN ps.best_score < 600000 THEN '500-600k'
      WHEN ps.best_score < 700000 THEN '600-700k'
      WHEN ps.best_score < 800000 THEN '700-800k'
      WHEN ps.best_score < 900000 THEN '800-900k'
      WHEN ps.best_score < 1000000 THEN '900k-1M'
      ELSE '1M+'
    END
  `;
}

const ACCURACY_BINS: Omit<DistributionBin, "count">[] = [
  { key: "unplayed", label: "Unplayed" },
  { key: "0-10", label: "0–10%" },
  { key: "10-20", label: "10–20%" },
  { key: "20-30", label: "20–30%" },
  { key: "30-40", label: "30–40%" },
  { key: "40-50", label: "40–50%" },
  { key: "50-60", label: "50–60%" },
  { key: "60-70", label: "60–70%" },
  { key: "70-80", label: "70–80%" },
  { key: "80-90", label: "80–90%" },
  { key: "90-100", label: "90–100%" },
];

const MISSES_BINS: Omit<DistributionBin, "count">[] = [
  { key: "unplayed", label: "Unplayed" },
  { key: "0", label: "0 (FC)" },
  { key: "1", label: "1" },
  { key: "2-5", label: "2–5" },
  { key: "6-10", label: "6–10" },
  { key: "11-25", label: "11–25" },
  { key: "26-50", label: "26–50" },
  { key: "51+", label: "51+" },
];

const SCORE_BINS: Omit<DistributionBin, "count">[] = [
  { key: "unplayed", label: "Unplayed" },
  { key: "0-100k", label: "0–100k" },
  { key: "100-200k", label: "100–200k" },
  { key: "200-300k", label: "200–300k" },
  { key: "300-400k", label: "300–400k" },
  { key: "400-500k", label: "400–500k" },
  { key: "500-600k", label: "500–600k" },
  { key: "600-700k", label: "600–700k" },
  { key: "700-800k", label: "700–800k" },
  { key: "800-900k", label: "800–900k" },
  { key: "900k-1M", label: "900k–1M" },
  { key: "1M+", label: "1M+" },
];

function metricConfig(metric: PracticeMetric): {
  expr: string;
  bins: Omit<DistributionBin, "count">[];
} {
  switch (metric) {
    case "misses":
      return { expr: missesBucketExpr(), bins: MISSES_BINS };
    case "score":
      return { expr: scoreBucketExpr(), bins: SCORE_BINS };
    case "accuracy":
    default:
      return { expr: accuracyBucketExpr(), bins: ACCURACY_BINS };
  }
}

function resolveFilter(query: string | undefined): {
  sql: string;
  params: unknown[];
} {
  const q = query?.trim();
  if (!q) return { sql: "1=1", params: [] };
  const compiled = compileQuery(parseQuery(q));
  return { sql: compiled.sql, params: compiled.params };
}

function mapRow(r: PracticeCardRow): PracticeCardRow {
  return {
    ...r,
    playCount: Number(r.playCount ?? 0),
    bestScore: r.bestScore != null ? Number(r.bestScore) : null,
    bestMisses: r.bestMisses != null ? Number(r.bestMisses) : null,
    masteryLevel: r.masteryLevel != null ? Number(r.masteryLevel) : null,
  };
}

export function executeAst(
  db: Db,
  ast: AstNode,
  opts: {
    limit: number;
    offset: number;
    sortBy?: PracticeSortBy;
    sortDir?: PracticeSortDir;
  },
): { items: PracticeCardRow[]; total: number } {
  const compiled = compileQuery(ast);
  return executeFilter(db, compiled.sql, compiled.params, opts);
}

function executeFilter(
  db: Db,
  filterSql: string,
  params: unknown[],
  opts: {
    limit: number;
    offset: number;
    sortBy?: PracticeSortBy;
    sortDir?: PracticeSortDir;
  },
): { items: PracticeCardRow[]; total: number } {
  const where = baseWhere(filterSql);
  const bindings = asBindings(params);
  const sortBy = opts.sortBy ?? "lastPlayed";
  const sortDir = opts.sortDir ?? "desc";

  const countSql = `SELECT COUNT(*) AS n ${BASE_FROM} ${where}`;
  const countRow = db.$client
    .query(countSql)
    .get(...bindings) as { n: number } | null;

  const listSql = `
    SELECT ${SELECT_COLS}
    ${BASE_FROM}
    ${where}
    ORDER BY ${orderBySql(sortBy, sortDir)}
    LIMIT ? OFFSET ?
  `;
  const items = db.$client
    .query(listSql)
    .all(...bindings, opts.limit, opts.offset) as PracticeCardRow[];

  return {
    items: items.map(mapRow),
    total: Number(countRow?.n ?? 0),
  };
}

export function searchBeatmaps(
  db: Db,
  query: string | undefined,
  opts: {
    page: number;
    pageSize: number;
    sortBy?: PracticeSortBy;
    sortDir?: PracticeSortDir;
  },
): {
  items: PracticeCardRow[];
  total: number;
  page: number;
  pageSize: number;
} {
  const filter = resolveFilter(query);
  const offset = (opts.page - 1) * opts.pageSize;
  const result = executeFilter(db, filter.sql, filter.params, {
    limit: opts.pageSize,
    offset,
    sortBy: opts.sortBy,
    sortDir: opts.sortDir,
  });
  return {
    ...result,
    page: opts.page,
    pageSize: opts.pageSize,
  };
}

export function countMatches(db: Db, query: string): number {
  const filter = resolveFilter(query);
  const where = baseWhere(filter.sql);
  const countSql = `SELECT COUNT(*) AS n ${BASE_FROM} ${where}`;
  const countRow = db.$client
    .query(countSql)
    .get(...asBindings(filter.params)) as { n: number } | null;
  return Number(countRow?.n ?? 0);
}

export function practiceDistribution(
  db: Db,
  query: string | undefined,
  metric: PracticeMetric,
): {
  metric: PracticeMetric;
  total: number;
  bins: DistributionBin[];
} {
  const filter = resolveFilter(query);
  const where = baseWhere(filter.sql);
  const { expr, bins: template } = metricConfig(metric);

  const distSql = `
    SELECT (${expr}) AS bucket, COUNT(*) AS count
    ${BASE_FROM}
    ${where}
    GROUP BY bucket
  `;
  const rows = db.$client
    .query(distSql)
    .all(...asBindings(filter.params)) as { bucket: string; count: number }[];

  const counts = new Map(rows.map((r) => [r.bucket, Number(r.count)]));
  const bins = template.map((b) => ({
    ...b,
    count: counts.get(b.key) ?? 0,
  }));
  const total = bins.reduce((sum, b) => sum + b.count, 0);

  return { metric, total, bins };
}
