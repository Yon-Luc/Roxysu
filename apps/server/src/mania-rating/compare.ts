import type { Db } from "@roxysu/db/client.bun";
import { parseQuery } from "../query-language/parse";
import { compileQuery } from "../query-language/compile";
import { searchBeatmaps } from "../query-language/execute";
import {
  backfillManiaRatingsSync,
  ensureManiaRatingsForIdsSync,
  RATING_QUERY_BACKFILL_LIMIT,
} from "./compute";
import { getVersion, usesImportedRating } from "./registry";
import {
  BEATMAP_SET_JOIN,
  beatmapFilterWhere,
} from "../query-language/sqlFragments";

export type RatingSide = {
  starRating: number | null;
  starRatingSs: number | null;
  ppSs: number | null;
  attributes: Record<string, unknown> | null;
  error: string | null;
};

export type CompareRow = {
  beatmapId: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  keyCount: number | null;
  importedStarRating: number;
  baseline: RatingSide;
  experiment: RatingSide;
  delta: {
    starRating: number | null;
    ppSs: number | null;
  };
  cached: {
    baseline: boolean;
    experiment: boolean;
  };
};

export type CompareResult = {
  page: number;
  pageSize: number;
  total: number;
  baselineVersionId: string;
  experimentVersionId: string;
  query: string;
  items: CompareRow[];
  computedThisRequest: {
    baseline: number;
    experiment: number;
  };
};

export type HistogramBin = {
  key: string;
  label: string;
  count: number;
};

export type CompareSummary = {
  query: string;
  baselineVersionId: string;
  experimentVersionId: string;
  totalMatches: number;
  comparedCount: number;
  missingBaseline: number;
  missingExperiment: number;
  meanDeltaStarRating: number | null;
  medianDeltaStarRating: number | null;
  meanDeltaPpSs: number | null;
  medianDeltaPpSs: number | null;
  starRatingHistogram: HistogramBin[];
  topStarMovers: CompareRow[];
  topPpMovers: CompareRow[];
};

type RatingJoinRow = {
  beatmap_id: string;
  title: string | null;
  artist: string | null;
  difficulty_name: string | null;
  circle_size: number | null;
  imported_star_rating: number;
  star_rating: number | null;
  star_rating_ss: number | null;
  pp_ss: number | null;
  attributes_json: string | null;
  error: string | null;
};

function parseAttributes(json: string | null): Record<string, unknown> | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function toSide(row: RatingJoinRow, prefix: "base" | "exp"): RatingSide {
  const starKey = prefix === "base" ? "base_star_rating" : "exp_star_rating";
  const ssKey = prefix === "base" ? "base_star_rating_ss" : "exp_star_rating_ss";
  const ppKey = prefix === "base" ? "base_pp_ss" : "exp_pp_ss";
  const attrKey = prefix === "base" ? "base_attributes_json" : "exp_attributes_json";
  const errKey = prefix === "base" ? "base_error" : "exp_error";

  const r = row as Record<string, unknown>;
  return {
    starRating: r[starKey] != null ? Number(r[starKey]) : null,
    starRatingSs: r[ssKey] != null ? Number(r[ssKey]) : null,
    ppSs: r[ppKey] != null ? Number(r[ppKey]) : null,
    attributes: parseAttributes(r[attrKey] as string | null),
    error: (r[errKey] as string | null) ?? null,
  };
}

function delta(a: number | null, b: number | null): number | null {
  if (a == null || b == null) return null;
  return b - a;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function buildHistogram(deltas: number[]): HistogramBin[] {
  const bins: HistogramBin[] = [
    { key: "lt-1", label: "< −1★", count: 0 },
    { key: "m1", label: "−1 to −0.5", count: 0 },
    { key: "m05", label: "−0.5 to −0.1", count: 0 },
    { key: "flat", label: "±0.1", count: 0 },
    { key: "p05", label: "+0.1 to +0.5", count: 0 },
    { key: "p1", label: "+0.5 to +1", count: 0 },
    { key: "gt1", label: "> +1★", count: 0 },
  ];

  for (const d of deltas) {
    if (d < -1) bins[0]!.count++;
    else if (d < -0.5) bins[1]!.count++;
    else if (d < -0.1) bins[2]!.count++;
    else if (d <= 0.1) bins[3]!.count++;
    else if (d <= 0.5) bins[4]!.count++;
    else if (d <= 1) bins[5]!.count++;
    else bins[6]!.count++;
  }

  return bins;
}

function mapCompareRow(
  row: RatingJoinRow,
  baselineVersionId: string,
): CompareRow {
  const baseline = toSide(row, "base");
  const experiment = toSide(row, "exp");
  const importedStar = Number(row.imported_star_rating);

  if (usesImportedRating(baselineVersionId)) {
    baseline.starRating = importedStar;
    baseline.error = null;
  }

  return {
    beatmapId: row.beatmap_id,
    title: row.title,
    artist: row.artist,
    difficultyName: row.difficulty_name,
    keyCount: row.circle_size != null ? Number(row.circle_size) : null,
    importedStarRating: importedStar,
    baseline,
    experiment,
    delta: {
      starRating: delta(baseline.starRating, experiment.starRating),
      ppSs: delta(baseline.ppSs, experiment.ppSs),
    },
    cached: {
      baseline:
        usesImportedRating(baselineVersionId) ||
        (baseline.starRating != null && baseline.error == null),
      experiment: experiment.starRating != null && experiment.error == null,
    },
  };
}

type SqlBinding = string | number | bigint | boolean | null;

function asBindings(params: unknown[]): SqlBinding[] {
  return params as SqlBinding[];
}

function resolveFilterSql(query: string): { sql: string; params: SqlBinding[] } {
  const ast = parseQuery(query);
  const compiled = compileQuery(ast);
  return { sql: compiled.sql, params: asBindings(compiled.params) };
}

function fetchCompareRows(
  db: Db,
  filterSql: string,
  params: SqlBinding[],
  baselineVersionId: string,
  experimentVersionId: string,
  limit: number,
  offset: number,
): RatingJoinRow[] {
  const where = beatmapFilterWhere(filterSql);
  const baseStarSql = usesImportedRating(baselineVersionId)
    ? "b.star_rating AS base_star_rating"
    : "base.star_rating AS base_star_rating";
  const sql = `
    SELECT
      b.id AS beatmap_id,
      b.title,
      b.artist,
      b.difficulty_name,
      b.circle_size,
      b.star_rating AS imported_star_rating,
      ${baseStarSql},
      base.star_rating_ss AS base_star_rating_ss,
      base.pp_ss AS base_pp_ss,
      base.attributes_json AS base_attributes_json,
      base.error AS base_error,
      exp.star_rating AS exp_star_rating,
      exp.star_rating_ss AS exp_star_rating_ss,
      exp.pp_ss AS exp_pp_ss,
      exp.attributes_json AS exp_attributes_json,
      exp.error AS exp_error
    FROM beatmaps b
    ${BEATMAP_SET_JOIN}
    LEFT JOIN beatmap_mania_ratings base
      ON base.beatmap_id = b.id AND base.version_id = ?
    LEFT JOIN beatmap_mania_ratings exp
      ON exp.beatmap_id = b.id AND exp.version_id = ?
    ${where}
    ORDER BY b.title COLLATE NOCASE, b.difficulty_name COLLATE NOCASE
    LIMIT ? OFFSET ?
  `;

  return db.$client
    .query(sql)
    .all(baselineVersionId, experimentVersionId, ...params, limit, offset) as RatingJoinRow[];
}

function countCompareRows(
  db: Db,
  filterSql: string,
  params: SqlBinding[],
): number {
  const where = beatmapFilterWhere(filterSql);
  const row = db.$client
    .query(
      `SELECT COUNT(*) AS n FROM beatmaps b ${BEATMAP_SET_JOIN} ${where}`,
    )
    .get(...params) as { n: number } | null;
  return Number(row?.n ?? 0);
}

function maybeEnsureRatings(
  db: Db,
  beatmapIds: string[],
  baselineVersionId: string,
  experimentVersionId: string,
): { baseline: number; experiment: number } {
  const slice = beatmapIds.slice(0, RATING_QUERY_BACKFILL_LIMIT);
  const baseResult = usesImportedRating(baselineVersionId)
    ? { succeeded: 0 }
    : backfillManiaRatingsSync(db, baselineVersionId, {
        limit: RATING_QUERY_BACKFILL_LIMIT,
        beatmapIds: slice,
      });
  const expResult = backfillManiaRatingsSync(db, experimentVersionId, {
    limit: RATING_QUERY_BACKFILL_LIMIT,
    beatmapIds: slice,
  });
  return {
    baseline: baseResult.succeeded,
    experiment: expResult.succeeded,
  };
}

export function compareManiaRatings(
  db: Db,
  options: {
    query: string;
    baselineVersionId: string;
    experimentVersionId: string;
    page?: number;
    pageSize?: number;
    ensureCompute?: boolean;
  },
): CompareResult {
  const baselineVersionId = options.baselineVersionId;
  const experimentVersionId = options.experimentVersionId;

  if (!getVersion(baselineVersionId)) {
    throw new Error(`Unknown baseline version: ${baselineVersionId}`);
  }
  if (!getVersion(experimentVersionId)) {
    throw new Error(`Unknown experiment version: ${experimentVersionId}`);
  }

  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 48));
  const offset = (page - 1) * pageSize;
  const query = options.query.trim();

  const { sql, params } = resolveFilterSql(query);
  const total = countCompareRows(db, sql, params);

  let computedThisRequest = { baseline: 0, experiment: 0 };

  if (options.ensureCompute !== false && total > 0) {
    const preview = searchBeatmaps(db, query, {
      page: 1,
      pageSize: RATING_QUERY_BACKFILL_LIMIT,
    });
    const ids = preview.items.map((i) => i.id);
    computedThisRequest = maybeEnsureRatings(
      db,
      ids,
      baselineVersionId,
      experimentVersionId,
    );
    if (!usesImportedRating(baselineVersionId)) {
      ensureManiaRatingsForIdsSync(db, baselineVersionId, ids);
    }
    ensureManiaRatingsForIdsSync(db, experimentVersionId, ids);
  }

  const rows = fetchCompareRows(
    db,
    sql,
    params,
    baselineVersionId,
    experimentVersionId,
    pageSize,
    offset,
  );

  return {
    page,
    pageSize,
    total,
    baselineVersionId,
    experimentVersionId,
    query,
    items: rows.map((row) => mapCompareRow(row, baselineVersionId)),
    computedThisRequest,
  };
}

export function summarizeManiaRatings(
  db: Db,
  options: {
    query: string;
    baselineVersionId: string;
    experimentVersionId: string;
    ensureCompute?: boolean;
  },
): CompareSummary {
  const query = options.query.trim();
  const { sql, params } = resolveFilterSql(query);

  if (options.ensureCompute !== false) {
    const preview = searchBeatmaps(db, query, {
      page: 1,
      pageSize: RATING_QUERY_BACKFILL_LIMIT,
    });
    const ids = preview.items.map((i) => i.id);
    if (!usesImportedRating(options.baselineVersionId)) {
      ensureManiaRatingsForIdsSync(db, options.baselineVersionId, ids);
    }
    ensureManiaRatingsForIdsSync(db, options.experimentVersionId, ids);
  }

  const allRows = fetchCompareRows(
    db,
    sql,
    params,
    options.baselineVersionId,
    options.experimentVersionId,
    5000,
    0,
  );
  const items = allRows.map((row) => mapCompareRow(row, options.baselineVersionId));

  const comparable = items.filter(
    (i) =>
      i.delta.starRating != null &&
      i.baseline.error == null &&
      i.experiment.error == null,
  );

  const starDeltas = comparable
    .map((i) => i.delta.starRating)
    .filter((v): v is number => v != null);
  const ppDeltas = comparable
    .map((i) => i.delta.ppSs)
    .filter((v): v is number => v != null);

  const topStarMovers = [...comparable]
    .sort(
      (a, b) =>
        Math.abs(b.delta.starRating ?? 0) - Math.abs(a.delta.starRating ?? 0),
    )
    .slice(0, 10);

  const topPpMovers = [...comparable]
    .sort((a, b) => Math.abs(b.delta.ppSs ?? 0) - Math.abs(a.delta.ppSs ?? 0))
    .slice(0, 10);

  return {
    query,
    baselineVersionId: options.baselineVersionId,
    experimentVersionId: options.experimentVersionId,
    totalMatches: items.length,
    comparedCount: comparable.length,
    missingBaseline: items.filter((i) => !i.cached.baseline).length,
    missingExperiment: items.filter((i) => !i.cached.experiment).length,
    meanDeltaStarRating: mean(starDeltas),
    medianDeltaStarRating: median(starDeltas),
    meanDeltaPpSs: mean(ppDeltas),
    medianDeltaPpSs: median(ppDeltas),
    starRatingHistogram: buildHistogram(starDeltas),
    topStarMovers,
    topPpMovers,
  };
}

export function compareRowsToCsv(rows: CompareRow[]): string {
  const header = [
    "beatmap_id",
    "title",
    "artist",
    "difficulty",
    "keys",
    "imported_sr",
    "baseline_sr",
    "experiment_sr",
    "delta_sr",
    "baseline_pp_ss",
    "experiment_pp_ss",
    "delta_pp_ss",
    "baseline_error",
    "experiment_error",
  ].join(",");

  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = rows.map((r) =>
    [
      r.beatmapId,
      r.title,
      r.artist,
      r.difficultyName,
      r.keyCount,
      r.importedStarRating,
      r.baseline.starRating,
      r.experiment.starRating,
      r.delta.starRating,
      r.baseline.ppSs,
      r.experiment.ppSs,
      r.delta.ppSs,
      r.baseline.error,
      r.experiment.error,
    ]
      .map(escape)
      .join(","),
  );

  return [header, ...lines].join("\n");
}
