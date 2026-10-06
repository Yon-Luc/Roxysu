import type { Db } from "@roxysu/db/types";
import { readFileSync } from "node:fs";

import {
  getOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import { toIso as toIsoNullable } from "../shared/serialize";
import { reworkDanLabel } from "./reworkDan";
import {
  REWORK_ALGORITHM,
  runReworkEstimatorFromText,
} from "./reworkEstimator";

export { REWORK_ALGORITHM };
export type { ReworkEstimatorResult } from "./reworkEstimator";

export type ReworkDanRating = {
  algorithm: typeof REWORK_ALGORITHM;
  beatmapHash: string | null;
  reworkStar: number | null;
  lnRatio: number | null;
  columnCount: number | null;
  estDiff: string | null;
  error: string | null;
  updatedAt: string;
  cached: boolean;
};

type StoredRow = {
  beatmap_id: string;
  algorithm: string;
  beatmap_hash: string | null;
  sunny_star: number | null;
  ln_ratio: number | null;
  column_count: number | null;
  est_diff: string | null;
  error: string | null;
  updated_at: number | Date;
};

function toIso(d: number | Date | null | undefined): string {
  const date = d == null ? null : new Date(d);
  return toIsoNullable(date) ?? new Date().toISOString();
}

function rowToResult(row: StoredRow, cached: boolean): ReworkDanRating {
  return {
    algorithm: REWORK_ALGORITHM,
    beatmapHash: row.beatmap_hash,
    reworkStar: row.sunny_star != null ? Number(row.sunny_star) : null,
    lnRatio: row.ln_ratio != null ? Number(row.ln_ratio) : null,
    columnCount: row.column_count != null ? Number(row.column_count) : null,
    estDiff: row.est_diff,
    error: row.error,
    updatedAt: toIso(row.updated_at),
    cached,
  };
}

function upsertRatingSync(
  db: Db,
  values: {
    beatmapId: string;
    beatmapHash: string | null;
    reworkStar: number | null;
    lnRatio: number | null;
    columnCount: number | null;
    estDiff: string | null;
    error: string | null;
    updatedAtMs: number;
  },
): ReworkDanRating {
  db.$client
    .query(
      `
      INSERT INTO beatmap_dan_ratings (
        beatmap_id, algorithm, beatmap_hash, sunny_star, ln_ratio,
        column_count, est_diff, error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(beatmap_id, algorithm) DO UPDATE SET
        beatmap_hash = excluded.beatmap_hash,
        sunny_star = excluded.sunny_star,
        ln_ratio = excluded.ln_ratio,
        column_count = excluded.column_count,
        est_diff = excluded.est_diff,
        error = excluded.error,
        updated_at = excluded.updated_at
    `,
    )
    .run(
      values.beatmapId,
      REWORK_ALGORITHM,
      values.beatmapHash,
      values.reworkStar,
      values.lnRatio,
      values.columnCount,
      values.estDiff,
      values.error,
      values.updatedAtMs,
    );

  return rowToResult(
    {
      beatmap_id: values.beatmapId,
      algorithm: REWORK_ALGORITHM,
      beatmap_hash: values.beatmapHash,
      sunny_star: values.reworkStar,
      ln_ratio: values.lnRatio,
      column_count: values.columnCount,
      est_diff: values.estDiff,
      error: values.error,
      updated_at: values.updatedAtMs,
    },
    false,
  );
}

/**
 * Estimate one map from lazer `.osu` and persist.
 *
 * Key modes without a dan table (e.g. 6K) still get a star rating and skills;
 * only the label is unknown.
 */
export function computeReworkDanSync(
  db: Db,
  beatmapId: string,
  hash: string | null,
): ReworkDanRating {
  const now = Date.now();

  const fail = (error: string, beatmapHash: string | null = hash) =>
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash,
      reworkStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error,
      updatedAtMs: now,
    });

  if (!hash) return fail("Beatmap hash missing", null);

  const filePath = resolveLazerFilePath(hash, getOsuDataPath());
  if (!filePath) return fail("Could not resolve lazer file path");

  let osuText: string;
  try {
    osuText = readFileSync(filePath, "utf8");
  } catch {
    return fail("Beatmap file not found in lazer files store");
  }

  try {
    const result = runReworkEstimatorFromText(osuText);
    return upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      reworkStar: result.star,
      lnRatio: result.lnRatio,
      columnCount: result.columnCount,
      estDiff: result.estDiff,
      error: null,
      updatedAtMs: now,
    });
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

type ReworkRow = {
  id: string;
  hash: string | null;
  ruleset_short_name: string | null;
};

/**
 * Re-apply current dan floors to cached rework ratings (no `.osu` re-read).
 * Run after editing `dans.json` so existing stars pick up the new labels.
 */
export function relabelReworkDanSync(db: Db): number {
  const rows = db.$client
    .query(
      `
      SELECT beatmap_id AS beatmapId, sunny_star AS reworkStar,
             ln_ratio AS lnRatio, column_count AS columnCount,
             est_diff AS estDiff
      FROM beatmap_dan_ratings
      WHERE algorithm = ?
        AND sunny_star IS NOT NULL
        AND ln_ratio IS NOT NULL
        AND column_count IS NOT NULL
        AND error IS NULL
    `,
    )
    .all(REWORK_ALGORITHM) as Array<{
    beatmapId: string;
    reworkStar: number;
    lnRatio: number;
    columnCount: number;
    estDiff: string | null;
  }>;

  const now = Date.now();
  let updated = 0;
  for (const row of rows) {
    const next = reworkDanLabel(row.reworkStar, row.lnRatio, row.columnCount);
    if (next === row.estDiff) continue;
    db.$client
      .query(
        `
        UPDATE beatmap_dan_ratings
        SET est_diff = ?, updated_at = ?
        WHERE beatmap_id = ? AND algorithm = ?
      `,
      )
      .run(next, now, row.beatmapId, REWORK_ALGORITHM);
    updated += 1;
  }
  return updated;
}

/** Count mania maps still needing a first successful rework rating. */
export function countReworkDanMissing(db: Db): number {
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
          OR dr.est_diff IS NULL
          OR (
            b.hash IS NOT NULL
            AND dr.beatmap_hash IS NOT NULL
            AND dr.beatmap_hash != b.hash
          )
        )
    `,
    )
    .get(REWORK_ALGORITHM) as { n: number } | null;
  return Number(row?.n ?? 0);
}

/** Cached rework rating for one beatmap, or null when unrated. */
export function getReworkDan(db: Db, beatmapId: string): ReworkDanRating | null {
  const row = db.$client
    .query(
      `
      SELECT beatmap_id, algorithm, beatmap_hash, sunny_star, ln_ratio,
             column_count, est_diff, error, updated_at
      FROM beatmap_dan_ratings
      WHERE beatmap_id = ? AND algorithm = ?
    `,
    )
    .get(beatmapId, REWORK_ALGORITHM) as StoredRow | null;
  if (!row) return null;
  return rowToResult(row, true);
}

/**
 * Ensure a rework rating exists for the given ids (all mania key modes).
 * Persists; single-map preview paths may still compute ephemerally instead.
 */
export function ensureReworkDanForIdsSync(
  db: Db,
  ids: string[],
): Map<string, { estDiff: string | null; reworkStar: number | null }> {
  const out = new Map<string, { estDiff: string | null; reworkStar: number | null }>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;

  const placeholders = unique.map(() => "?").join(",");
  const rows = db.$client
    .query(
      `
      SELECT b.id AS id, b.hash AS hash,
             b.ruleset_short_name AS rulesetShortName,
             dr.est_diff AS estDiff,
             dr.sunny_star AS reworkStar
      FROM beatmaps b
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE b.id IN (${placeholders})
    `,
    )
    .all(REWORK_ALGORITHM, ...unique) as Array<{
    id: string;
    hash: string | null;
    rulesetShortName: string | null;
    estDiff: string | null;
    reworkStar: number | null;
  }>;

  for (const row of rows) {
    if (row.estDiff) {
      out.set(row.id, {
        estDiff: row.estDiff,
        reworkStar: row.reworkStar != null ? Number(row.reworkStar) : null,
      });
      continue;
    }
    if (row.rulesetShortName !== "mania") continue;
    computeReworkDanSync(db, row.id, row.hash);
    const updated = db.$client
      .query(
        `
        SELECT est_diff AS estDiff, sunny_star AS reworkStar
        FROM beatmap_dan_ratings
        WHERE beatmap_id = ? AND algorithm = ?
      `,
      )
      .get(row.id, REWORK_ALGORITHM) as {
      estDiff: string | null;
      reworkStar: number | null;
    } | null;
    out.set(row.id, {
      estDiff: updated?.estDiff ?? null,
      reworkStar:
        updated?.reworkStar != null ? Number(updated.reworkStar) : null,
    });
  }

  return out;
}

/** Compute rework dan for mania maps missing a fresh rating. */
export function backfillReworkDanSync(
  db: Db,
  opts: {
    limit?: number;
    includeFailed?: boolean;
    /** Skip the relabel pass (the job relabels once at start). */
    skipRelabel?: boolean;
  } = {},
): {
  attempted: number;
  succeeded: number;
  remaining: number;
  relabeled: number;
  computed: number;
} {
  const relabeled = opts.skipRelabel ? 0 : relabelReworkDanSync(db);
  const limit = Math.max(1, Math.min(500, opts.limit ?? 80));
  const includeFailed = opts.includeFailed === true;

  const missingClause = includeFailed
    ? `
        (
          dr.beatmap_id IS NULL
          OR dr.est_diff IS NULL
          OR (
            b.hash IS NOT NULL
            AND dr.beatmap_hash IS NOT NULL
            AND dr.beatmap_hash != b.hash
          )
        )
      `
    : `
        (
          dr.beatmap_id IS NULL
          OR (
            b.hash IS NOT NULL
            AND dr.beatmap_hash IS NOT NULL
            AND dr.beatmap_hash != b.hash
          )
        )
      `;

  const missing = db.$client
    .query(
      `
      SELECT b.id AS id, b.hash AS hash,
             b.ruleset_short_name AS ruleset_short_name
      FROM beatmaps b
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND ${missingClause}
      ORDER BY
        CASE
          WHEN dr.beatmap_id IS NULL THEN 0
          WHEN b.hash IS NOT NULL
            AND dr.beatmap_hash IS NOT NULL
            AND dr.beatmap_hash != b.hash THEN 1
          ELSE 2
        END,
        b.id
      LIMIT ?
    `,
    )
    .all(REWORK_ALGORITHM, limit) as ReworkRow[];

  let succeeded = 0;
  for (const row of missing) {
    computeReworkDanSync(db, row.id, row.hash);
    const updated = db.$client
      .query(
        `
        SELECT est_diff AS estDiff
        FROM beatmap_dan_ratings
        WHERE beatmap_id = ? AND algorithm = ?
      `,
      )
      .get(row.id, REWORK_ALGORITHM) as { estDiff: string | null } | null;
    if (updated?.estDiff) succeeded += 1;
  }

  return {
    attempted: missing.length,
    succeeded,
    remaining: countReworkDanMissing(db),
    relabeled,
    computed: missing.length,
  };
}