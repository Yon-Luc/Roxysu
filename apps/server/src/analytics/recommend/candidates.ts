import type { Db } from "@roxysu/db/types";
import { REWORK_ALGORITHM } from "../../map-analysis/reworkEstimator";
import {
  DEFAULT_AXIS_THRESHOLDS,
  type AxisThresholds,
} from "./axisThresholds";

export type CandidateRow = {
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
  reworkEstDiff: string | null;
  reworkStar: number | null;
  lnRatio: number | null;
  keyCount: number | null;
};

export function countMissingReworkDan(db: Db, keyCount?: number): number {
  const params: Array<string | number> = [REWORK_ALGORITHM];
  let keySql = "";
  if (keyCount != null) {
    keySql = `AND b.circle_size = ?`;
    params.push(keyCount);
  }
  const row = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE b.hidden = 0
        AND b.ruleset_short_name = 'mania'
        ${keySql}
        AND (
          dr.beatmap_id IS NULL
          OR (
            b.hash IS NOT NULL
            AND dr.beatmap_hash IS NOT NULL
            AND dr.beatmap_hash != b.hash
          )
        )
    `,
    )
    .get(...params) as { n: number } | null;
  return Number(row?.n ?? 0);
}

export function buildBaseKeymodeFilter(
  minRework: number,
  maxRework: number,
  axis: "rc" | "ln" | "fln" | null,
  overlaySql: string | null,
  overlayParams: unknown[],
  keyCount: number,
  thresholds: AxisThresholds = DEFAULT_AXIS_THRESHOLDS,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const push = (v: unknown) => {
    params.push(v);
    return `?`;
  };

  const parts = [
    `LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'`,
    `b.circle_size = ${push(keyCount)}`,
    `dr.sunny_star IS NOT NULL`,
    `dr.sunny_star BETWEEN ${push(minRework)} AND ${push(maxRework)}`,
  ];

  if (axis === "fln") {
    parts.push(`COALESCE(dr.ln_ratio, 0) >= ${push(thresholds.fln)}`);
  } else if (axis === "ln") {
    parts.push(`COALESCE(dr.ln_ratio, 0) >= ${push(thresholds.ln)}`);
    parts.push(`COALESCE(dr.ln_ratio, 0) < ${push(thresholds.fln)}`);
  } else if (axis === "rc") {
    parts.push(`COALESCE(dr.ln_ratio, 0) < ${push(thresholds.ln)}`);
  }

  if (overlaySql) {
    parts.push(`(${overlaySql})`);
    params.push(...overlayParams);
  }

  return { sql: parts.join(" AND "), params };
}

export function loadCandidates(
  db: Db,
  filterSql: string,
  filterParams: unknown[],
  excludeIds: string[],
  limit: number,
): CandidateRow[] {
  const bind: Array<string | number | bigint | boolean | null> = [
    REWORK_ALGORITHM,
    ...(filterParams as Array<string | number | bigint | boolean | null>),
  ];
  let excludeSql = "";
  if (excludeIds.length > 0) {
    const placeholders = excludeIds.map(() => "?").join(",");
    excludeSql = ` AND b.id NOT IN (${placeholders})`;
    bind.push(...excludeIds);
  }
  bind.push(limit);

  const sql = `
    SELECT
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
      COALESCE(m.play_count, 0) AS playCount,
      m.best_accuracy AS bestAccuracy,
      m.best_pp AS bestPp,
      m.best_score AS bestScore,
      m.best_misses AS bestMisses,
      m.last_played_at AS lastPlayedAt,
      m.level AS masteryLevel,
      dr.est_diff AS reworkEstDiff,
      dr.sunny_star AS reworkStar,
      dr.ln_ratio AS lnRatio,
      CAST(b.circle_size AS INTEGER) AS keyCount
    FROM beatmaps b
    LEFT JOIN mastery m ON m.beatmap_id = b.id
    LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
    LEFT JOIN beatmap_dan_ratings dr
      ON dr.beatmap_id = b.id AND dr.algorithm = ?
    WHERE b.hidden = 0
      AND COALESCE(bs.delete_pending, 0) = 0
      AND (${filterSql})
      ${excludeSql}
    ORDER BY RANDOM()
    LIMIT ?
  `;

  const rows = db.$client.query(sql).all(...bind) as CandidateRow[];

  return rows.map((r) => ({
    ...r,
    onlineId: r.onlineId != null ? Number(r.onlineId) : null,
    setOnlineId: r.setOnlineId != null ? Number(r.setOnlineId) : null,
    playCount: Number(r.playCount ?? 0),
    bestAccuracy: r.bestAccuracy != null ? Number(r.bestAccuracy) : null,
    bestPp: r.bestPp != null ? Number(r.bestPp) : null,
    bestScore: r.bestScore != null ? Number(r.bestScore) : null,
    bestMisses: r.bestMisses != null ? Number(r.bestMisses) : null,
    lastPlayedAt: r.lastPlayedAt != null ? Number(r.lastPlayedAt) : null,
    masteryLevel: r.masteryLevel != null ? Number(r.masteryLevel) : null,
    reworkStar: r.reworkStar != null ? Number(r.reworkStar) : null,
    lnRatio: r.lnRatio != null ? Number(r.lnRatio) : null,
    keyCount: r.keyCount != null ? Number(r.keyCount) : null,
  }));
}

export function countKeymodeWithRework(db: Db, keyCount: number): number {
  const row = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      WHERE b.hidden = 0
        AND COALESCE(bs.delete_pending, 0) = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = ?
        AND dr.sunny_star IS NOT NULL
    `,
    )
    .get(REWORK_ALGORITHM, keyCount) as { n: number } | null;
  return Number(row?.n ?? 0);
}
