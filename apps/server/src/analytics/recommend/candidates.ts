import type { Db } from "@roxysu/db/client.bun";
import { SUNNY_ALGORITHM } from "../../map-analysis/computeSunnyDan";
import {
  FLN_RATIO_THRESHOLD,
  LN_DAN_RATIO_THRESHOLD,
} from "../../map-analysis/estDiff";

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
  sunnyEstDiff: string | null;
  sunnyStar: number | null;
  lnRatio: number | null;
};

export function countMissingSunnyDan(db: Db): number {
  const row = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
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
    .get(SUNNY_ALGORITHM) as { n: number } | null;
  return Number(row?.n ?? 0);
}

export function buildBaseSevenKFilter(
  minSunny: number,
  maxSunny: number,
  axis: "rc" | "ln" | "fln" | null,
  overlaySql: string | null,
  overlayParams: unknown[],
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const push = (v: unknown) => {
    params.push(v);
    return `?`;
  };

  const parts = [
    `LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'`,
    `b.circle_size = 7`,
    `dr.sunny_star IS NOT NULL`,
    `dr.sunny_star BETWEEN ${push(minSunny)} AND ${push(maxSunny)}`,
  ];

  if (axis === "fln") {
    parts.push(`COALESCE(dr.ln_ratio, 0) >= ${push(FLN_RATIO_THRESHOLD)}`);
  } else if (axis === "ln") {
    parts.push(`COALESCE(dr.ln_ratio, 0) >= ${push(LN_DAN_RATIO_THRESHOLD)}`);
    parts.push(`COALESCE(dr.ln_ratio, 0) < ${push(FLN_RATIO_THRESHOLD)}`);
  } else if (axis === "rc") {
    parts.push(`COALESCE(dr.ln_ratio, 0) < ${push(LN_DAN_RATIO_THRESHOLD)}`);
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
  const params = [...filterParams];
  let excludeSql = "";
  if (excludeIds.length > 0) {
    const placeholders = excludeIds.map(() => "?").join(",");
    excludeSql = ` AND b.id NOT IN (${placeholders})`;
    params.push(...excludeIds);
  }

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
      COALESCE(ps.play_count, 0) AS playCount,
      ps.best_accuracy AS bestAccuracy,
      ps.best_pp AS bestPp,
      ps.best_score AS bestScore,
      ps.best_misses AS bestMisses,
      ps.last_played_at AS lastPlayedAt,
      m.level AS masteryLevel,
      dr.est_diff AS sunnyEstDiff,
      dr.sunny_star AS sunnyStar,
      dr.ln_ratio AS lnRatio
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

  const rows = db.$client
    .query(sql)
    .all(
      SUNNY_ALGORITHM,
      ...(params as Array<string | number | bigint | boolean | null>),
      limit,
    ) as CandidateRow[];

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
    sunnyStar: r.sunnyStar != null ? Number(r.sunnyStar) : null,
    lnRatio: r.lnRatio != null ? Number(r.lnRatio) : null,
  }));
}

export function countSevenKWithSunny(db: Db): number {
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
        AND b.circle_size = 7
        AND dr.sunny_star IS NOT NULL
    `,
    )
    .get(SUNNY_ALGORITHM) as { n: number } | null;
  return Number(row?.n ?? 0);
}
