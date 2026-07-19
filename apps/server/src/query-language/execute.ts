import type { Db } from "@roxysu/db/client.bun";
import { parseQuery } from "./parse";
import { compileQuery } from "./compile";
import type { AstNode } from "./ast";
import { astUsesDanRating } from "./astUsesDan";
import { backfillSunnyDanSync } from "../map-analysis/computeSunnyDan";

/** Max maps to compute per dan/sunny query so first filter stays responsive. */
const DAN_QUERY_BACKFILL_LIMIT = 120;

export type PracticeCardRow = {
  id: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  starRating: number;
  bpm: number;
  rulesetShortName: string | null;
  mapperUsername: string | null;
  onlineId: number | null;
  setOnlineId: number | null;
  backgroundFileHash: string | null;
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
  LEFT JOIN beatmap_dan_ratings dr
    ON dr.beatmap_id = b.id AND dr.algorithm = 'sunny'
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
  CASE WHEN b.online_id > 0 THEN b.online_id ELSE NULL END AS onlineId,
  CASE WHEN bs.online_id > 0 THEN bs.online_id ELSE NULL END AS setOnlineId,
  b.background_file_hash AS backgroundFileHash,
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

const MISSES_BINS: Omit<DistributionBin, "count">[] = [
  { key: "unplayed", label: "Unplayed" },
  { key: "51+", label: "51+" },
  { key: "26-50", label: "26–50" },
  { key: "11-25", label: "11–25" },
  { key: "6-10", label: "6–10" },
  { key: "2-5", label: "2–5" },
  { key: "1", label: "1" },
  { key: "0", label: "0 (FC)" },
];

/** Pick a nice percent step so ~8–12 bins cover [min, max]. */
function chooseAccuracyStepPct(minAcc: number, maxAcc: number): number {
  const spanPct = Math.max((maxAcc - minAcc) * 100, 0.01);
  // Drill-down into a narrow window (e.g. after clicking a 2% bar).
  if (spanPct < 2) return 0.1;
  const raw = spanPct / 10;
  const nice = [0.5, 1, 2, 2.5, 5, 10];
  return nice.find((s) => s >= raw) ?? 10;
}

/** Pick a nice score step so ~8–12 bins cover [min, max]. */
function chooseScoreStep(minScore: number, maxScore: number): number {
  const span = Math.max(maxScore - minScore, 1);
  const raw = span / 10;
  const nice = [
    5_000, 10_000, 25_000, 50_000, 100_000, 200_000, 250_000, 500_000, 1_000_000,
  ];
  return nice.find((s) => s >= raw) ?? Math.ceil(raw / 100_000) * 100_000;
}

function formatScoreShort(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${parseFloat(m.toFixed(2))}M`;
  }
  if (n >= 1_000) {
    const k = n / 1_000;
    return Number.isInteger(k) ? `${k}k` : `${parseFloat(k.toFixed(1))}k`;
  }
  return String(Math.round(n));
}

function formatAccLabel(fromPct: number, toPct: number): string {
  const fmt = (n: number) =>
    Number.isInteger(n) ? String(n) : parseFloat(n.toFixed(1)).toString();
  return `${fmt(fromPct)}–${fmt(toPct)}%`;
}

function resolveFilter(query: string | undefined): {
  sql: string;
  params: unknown[];
  needsDanBackfill: boolean;
} {
  const q = query?.trim();
  if (!q) return { sql: "1=1", params: [], needsDanBackfill: false };
  const ast = parseQuery(q);
  const compiled = compileQuery(ast);
  return {
    sql: compiled.sql,
    params: compiled.params,
    needsDanBackfill: astUsesDanRating(ast),
  };
}

function maybeBackfillDan(db: Db, needsDanBackfill: boolean): void {
  if (!needsDanBackfill) return;
  backfillSunnyDanSync(db, { limit: DAN_QUERY_BACKFILL_LIMIT });
}

function mapRow(r: PracticeCardRow): PracticeCardRow {
  return {
    ...r,
    onlineId: r.onlineId != null ? Number(r.onlineId) : null,
    setOnlineId: r.setOnlineId != null ? Number(r.setOnlineId) : null,
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
  if (astUsesDanRating(ast)) {
    backfillSunnyDanSync(db, { limit: DAN_QUERY_BACKFILL_LIMIT });
  }
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
  maybeBackfillDan(db, filter.needsDanBackfill);
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

/** Random sample matching a QL filter (optionally excluding beatmap ids). */
export function sampleBeatmaps(
  db: Db,
  query: string | undefined,
  opts: {
    count: number;
    excludeIds?: string[];
  },
): { items: PracticeCardRow[]; total: number } {
  const filter = resolveFilter(query);
  maybeBackfillDan(db, filter.needsDanBackfill);
  let filterSql = filter.sql;
  const params = [...filter.params];

  const exclude = (opts.excludeIds ?? []).filter(Boolean);
  if (exclude.length > 0) {
    const placeholders = exclude.map(() => "?").join(",");
    filterSql = `(${filterSql}) AND b.id NOT IN (${placeholders})`;
    params.push(...exclude);
  }

  const where = baseWhere(filterSql);
  const bindings = asBindings(params);
  const count = Math.max(1, Math.min(20, Math.floor(opts.count)));

  const countSql = `SELECT COUNT(*) AS n ${BASE_FROM} ${where}`;
  const countRow = db.$client
    .query(countSql)
    .get(...bindings) as { n: number } | null;

  const listSql = `
    SELECT ${SELECT_COLS}
    ${BASE_FROM}
    ${where}
    ORDER BY RANDOM()
    LIMIT ?
  `;
  const items = db.$client
    .query(listSql)
    .all(...bindings, count) as PracticeCardRow[];

  return {
    items: items.map(mapRow),
    total: Number(countRow?.n ?? 0),
  };
}

export function countMatches(db: Db, query: string): number {
  const filter = resolveFilter(query);
  maybeBackfillDan(db, filter.needsDanBackfill);
  const where = baseWhere(filter.sql);
  const countSql = `SELECT COUNT(*) AS n ${BASE_FROM} ${where}`;
  const countRow = db.$client
    .query(countSql)
    .get(...asBindings(filter.params)) as { n: number } | null;
  return Number(countRow?.n ?? 0);
}

function distributionMisses(
  db: Db,
  where: string,
  params: unknown[],
): DistributionBin[] {
  const distSql = `
    SELECT (${missesBucketExpr()}) AS bucket, COUNT(*) AS count
    ${BASE_FROM}
    ${where}
    GROUP BY bucket
  `;
  const rows = db.$client
    .query(distSql)
    .all(...asBindings(params)) as { bucket: string; count: number }[];
  const counts = new Map(rows.map((r) => [r.bucket, Number(r.count)]));
  return MISSES_BINS.map((b) => ({
    ...b,
    count: counts.get(b.key) ?? 0,
  })).filter((b) => b.count > 0);
}

function distributionAccuracy(
  db: Db,
  where: string,
  params: unknown[],
): DistributionBin[] {
  const rangeSql = `
    SELECT
      MIN(ps.best_accuracy) AS min_acc,
      MAX(ps.best_accuracy) AS max_acc,
      SUM(CASE WHEN ps.best_accuracy IS NULL THEN 1 ELSE 0 END) AS unplayed,
      SUM(CASE WHEN ps.best_accuracy IS NOT NULL THEN 1 ELSE 0 END) AS played
    ${BASE_FROM}
    ${where}
  `;
  const range = db.$client.query(rangeSql).get(...asBindings(params)) as {
    min_acc: number | null;
    max_acc: number | null;
    unplayed: number;
    played: number;
  } | null;

  const bins: DistributionBin[] = [];
  const unplayed = Number(range?.unplayed ?? 0);
  if (unplayed > 0) {
    bins.push({ key: "unplayed", label: "Unplayed", count: unplayed });
  }

  const played = Number(range?.played ?? 0);
  if (range?.min_acc == null || range.max_acc == null || played <= 0) {
    return bins;
  }

  const maxAcc = Number(range.max_acc);
  // Use ~5th percentile as the lower edge for step sizing so a few bad
  // outliers don't force coarse 10% buckets across 0–100%.
  const pOffset = Math.max(0, Math.floor(played * 0.05));
  const pRow = db.$client
    .query(
      `
      SELECT ps.best_accuracy AS acc
      ${BASE_FROM}
      ${where}
        AND ps.best_accuracy IS NOT NULL
      ORDER BY ps.best_accuracy ASC
      LIMIT 1 OFFSET ?
    `,
    )
    .get(...asBindings([...params, pOffset])) as { acc: number } | null;
  const effectiveMin = Number(pRow?.acc ?? range.min_acc);
  const stepPct = chooseAccuracyStepPct(effectiveMin, maxAcc);
  // Bucket in tenths-of-a-percent integers to avoid float drift at 0.1% steps.
  const stepTenths = Math.max(1, Math.round(stepPct * 10));

  const distSql = `
    SELECT
      CAST(FLOOR(ps.best_accuracy * 1000.0 / ?) * ? AS INTEGER) AS bucket_tenths,
      COUNT(*) AS count
    ${BASE_FROM}
    ${where}
      AND ps.best_accuracy IS NOT NULL
    GROUP BY bucket_tenths
    ORDER BY bucket_tenths ASC
  `;
  const rows = db.$client
    .query(distSql)
    .all(...asBindings([stepTenths, stepTenths, ...params])) as {
    bucket_tenths: number;
    count: number;
  }[];

  for (const row of rows) {
    const fromTenths = Number(row.bucket_tenths);
    const toTenths = Math.min(fromTenths + stepTenths, 1000);
    const from = fromTenths / 10;
    const to = toTenths / 10;
    const count = Number(row.count);
    if (count <= 0) continue;
    const keyFrom =
      fromTenths % 10 === 0 ? String(fromTenths / 10) : (fromTenths / 10).toFixed(1);
    const keyTo =
      toTenths % 10 === 0 ? String(toTenths / 10) : (toTenths / 10).toFixed(1);
    bins.push({
      key: `${keyFrom}-${keyTo}`,
      label:
        from >= 100 || (from === to && from === 100)
          ? "100%"
          : formatAccLabel(from, to),
      count,
    });
  }

  return bins;
}

function distributionScore(
  db: Db,
  where: string,
  params: unknown[],
): DistributionBin[] {
  const rangeSql = `
    SELECT
      MIN(ps.best_score) AS min_score,
      MAX(ps.best_score) AS max_score,
      SUM(CASE WHEN ps.best_score IS NULL THEN 1 ELSE 0 END) AS unplayed,
      SUM(CASE WHEN ps.best_score IS NOT NULL THEN 1 ELSE 0 END) AS played
    ${BASE_FROM}
    ${where}
  `;
  const range = db.$client.query(rangeSql).get(...asBindings(params)) as {
    min_score: number | null;
    max_score: number | null;
    unplayed: number;
    played: number;
  } | null;

  const bins: DistributionBin[] = [];
  const unplayed = Number(range?.unplayed ?? 0);
  if (unplayed > 0) {
    bins.push({ key: "unplayed", label: "Unplayed", count: unplayed });
  }

  const played = Number(range?.played ?? 0);
  if (range?.min_score == null || range.max_score == null || played <= 0) {
    return bins;
  }

  const maxScore = Number(range.max_score);
  const pOffset = Math.max(0, Math.floor(played * 0.05));
  const pRow = db.$client
    .query(
      `
      SELECT ps.best_score AS score
      ${BASE_FROM}
      ${where}
        AND ps.best_score IS NOT NULL
      ORDER BY ps.best_score ASC
      LIMIT 1 OFFSET ?
    `,
    )
    .get(...asBindings([...params, pOffset])) as { score: number } | null;
  const effectiveMin = Number(pRow?.score ?? range.min_score);
  const step = chooseScoreStep(effectiveMin, maxScore);

  const distSql = `
    SELECT
      CAST(FLOOR(ps.best_score * 1.0 / ?) * ? AS INTEGER) AS bucket_start,
      COUNT(*) AS count
    ${BASE_FROM}
    ${where}
      AND ps.best_score IS NOT NULL
    GROUP BY bucket_start
    ORDER BY bucket_start ASC
  `;
  const rows = db.$client
    .query(distSql)
    .all(...asBindings([step, step, ...params])) as {
    bucket_start: number;
    count: number;
  }[];

  for (const row of rows) {
    const from = Number(row.bucket_start);
    const to = from + step;
    const count = Number(row.count);
    if (count <= 0) continue;
    bins.push({
      key: `${from}-${to}`,
      label: `${formatScoreShort(from)}–${formatScoreShort(to)}`,
      count,
    });
  }

  return bins;
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
  maybeBackfillDan(db, filter.needsDanBackfill);
  const where = baseWhere(filter.sql);
  const params = filter.params;

  const bins =
    metric === "misses"
      ? distributionMisses(db, where, params)
      : metric === "score"
        ? distributionScore(db, where, params)
        : distributionAccuracy(db, where, params);

  const total = bins.reduce((sum, b) => sum + b.count, 0);
  return { metric, total, bins };
}

