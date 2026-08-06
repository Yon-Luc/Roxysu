import type { Db } from "@roxysu/db/types";
import { beatmapDanRatings, beatmaps } from "@roxysu/db/schema";
import { readFileSync } from "node:fs";
import { eq, and } from "drizzle-orm";

import {
  getOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import { runDanielEstimatorFromText } from "./danielEstimator";
import { toIso as toIsoNullable } from "../shared/serialize";

export const DANIEL_ALGORITHM = "daniel";

export type DanielDanRating = {
  algorithm: typeof DANIEL_ALGORITHM;
  beatmapHash: string | null;
  danielStar: number | null;
  lnRatio: number | null;
  columnCount: number | null;
  estDiff: string | null;
  numericDifficulty: number | null;
  error: string | null;
  updatedAt: string;
  cached: boolean;
};

function toIso(d: Date | null | undefined): string {
  return toIsoNullable(d) ?? new Date().toISOString();
}

function rowToResult(
  row: typeof beatmapDanRatings.$inferSelect,
  cached: boolean,
): DanielDanRating {
  return {
    algorithm: DANIEL_ALGORITHM,
    beatmapHash: row.beatmapHash,
    danielStar: row.sunnyStar,
    lnRatio: row.lnRatio,
    columnCount: row.columnCount,
    estDiff: row.estDiff,
    numericDifficulty: null,
    error: row.error,
    updatedAt: toIso(row.updatedAt),
    cached,
  };
}

async function upsertRating(
  db: Db,
  values: typeof beatmapDanRatings.$inferInsert,
): Promise<DanielDanRating> {
  await db
    .insert(beatmapDanRatings)
    .values(values)
    .onConflictDoUpdate({
      target: [beatmapDanRatings.beatmapId, beatmapDanRatings.algorithm],
      set: {
        beatmapHash: values.beatmapHash,
        sunnyStar: values.sunnyStar,
        lnRatio: values.lnRatio,
        columnCount: values.columnCount,
        estDiff: values.estDiff,
        error: values.error,
        updatedAt: values.updatedAt,
      },
    });

  return rowToResult(
    {
      beatmapId: values.beatmapId,
      algorithm: values.algorithm,
      beatmapHash: values.beatmapHash ?? null,
      sunnyStar: values.sunnyStar ?? null,
      lnRatio: values.lnRatio ?? null,
      columnCount: values.columnCount ?? null,
      estDiff: values.estDiff ?? null,
      error: values.error ?? null,
      updatedAt: values.updatedAt,
    },
    false,
  );
}

function isFourKMania(
  rulesetShortName: string | null | undefined,
  circleSize: number | null | undefined,
): boolean {
  if (rulesetShortName !== "mania") return false;
  if (circleSize == null) return false;
  return Math.round(circleSize) === 4;
}

/**
 * Return cached Daniel dan rating, or compute from local lazer `.osu` (4K only).
 */
export async function getOrComputeDanielDan(
  db: Db,
  beatmapId: string,
  options: { force?: boolean } = {},
): Promise<DanielDanRating | null> {
  const [beatmap] = await db
    .select({
      id: beatmaps.id,
      hash: beatmaps.hash,
      rulesetShortName: beatmaps.rulesetShortName,
      circleSize: beatmaps.circleSize,
    })
    .from(beatmaps)
    .where(eq(beatmaps.id, beatmapId))
    .limit(1);

  if (!beatmap) return null;

  if (!options.force) {
    const [cached] = await db
      .select()
      .from(beatmapDanRatings)
      .where(
        and(
          eq(beatmapDanRatings.beatmapId, beatmapId),
          eq(beatmapDanRatings.algorithm, DANIEL_ALGORITHM),
        ),
      )
      .limit(1);

    if (
      cached &&
      cached.beatmapHash === beatmap.hash &&
      cached.error == null &&
      cached.estDiff != null &&
      cached.sunnyStar != null
    ) {
      return rowToResult(cached, true);
    }
  }

  const now = new Date();

  if (!isFourKMania(beatmap.rulesetShortName, beatmap.circleSize)) {
    return upsertRating(db, {
      beatmapId,
      algorithm: DANIEL_ALGORITHM,
      beatmapHash: beatmap.hash,
      sunnyStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Not a 4K mania beatmap",
      updatedAt: now,
    });
  }

  if (!beatmap.hash) {
    return upsertRating(db, {
      beatmapId,
      algorithm: DANIEL_ALGORITHM,
      beatmapHash: null,
      sunnyStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Beatmap hash missing",
      updatedAt: now,
    });
  }

  const filePath = resolveLazerFilePath(beatmap.hash, getOsuDataPath());
  if (!filePath) {
    return upsertRating(db, {
      beatmapId,
      algorithm: DANIEL_ALGORITHM,
      beatmapHash: beatmap.hash,
      sunnyStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Could not resolve lazer file path",
      updatedAt: now,
    });
  }

  let osuText: string;
  try {
    osuText = readFileSync(filePath, "utf8");
  } catch {
    return upsertRating(db, {
      beatmapId,
      algorithm: DANIEL_ALGORITHM,
      beatmapHash: beatmap.hash,
      sunnyStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Beatmap file not found in lazer files store",
      updatedAt: now,
    });
  }

  try {
    const result = runDanielEstimatorFromText(osuText);
    const rating = await upsertRating(db, {
      beatmapId,
      algorithm: DANIEL_ALGORITHM,
      beatmapHash: beatmap.hash,
      sunnyStar: result.star,
      lnRatio: result.lnRatio,
      columnCount: result.columnCount,
      estDiff: result.estDiff,
      error: null,
      updatedAt: now,
    });
    return { ...rating, numericDifficulty: result.numericDifficulty };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return upsertRating(db, {
      beatmapId,
      algorithm: DANIEL_ALGORITHM,
      beatmapHash: beatmap.hash,
      sunnyStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: message,
      updatedAt: now,
    });
  }
}

type MissingDanielRow = {
  id: string;
  hash: string | null;
  ruleset_short_name: string | null;
  circle_size: number | null;
};

function upsertRatingSync(
  db: Db,
  values: {
    beatmapId: string;
    beatmapHash: string | null;
    danielStar: number | null;
    lnRatio: number | null;
    columnCount: number | null;
    estDiff: string | null;
    error: string | null;
    updatedAtMs: number;
  },
): void {
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
      DANIEL_ALGORITHM,
      values.beatmapHash,
      values.danielStar,
      values.lnRatio,
      values.columnCount,
      values.estDiff,
      values.error,
      values.updatedAtMs,
    );
}

function computeOneDanielSync(
  db: Db,
  beatmapId: string,
  hash: string | null,
  rulesetShortName: string | null,
  circleSize: number | null,
): void {
  const now = Date.now();

  if (!isFourKMania(rulesetShortName, circleSize)) {
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      danielStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Not a 4K mania beatmap",
      updatedAtMs: now,
    });
    return;
  }

  if (!hash) {
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: null,
      danielStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Beatmap hash missing",
      updatedAtMs: now,
    });
    return;
  }

  const filePath = resolveLazerFilePath(hash, getOsuDataPath());
  if (!filePath) {
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      danielStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Could not resolve lazer file path",
      updatedAtMs: now,
    });
    return;
  }

  let osuText: string;
  try {
    osuText = readFileSync(filePath, "utf8");
  } catch {
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      danielStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Beatmap file not found in lazer files store",
      updatedAtMs: now,
    });
    return;
  }

  try {
    const result = runDanielEstimatorFromText(osuText);
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      danielStar: result.star,
      lnRatio: result.lnRatio,
      columnCount: result.columnCount,
      estDiff: result.estDiff,
      error: null,
      updatedAtMs: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      danielStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: message,
      updatedAtMs: now,
    });
  }
}

export type DanielDanEnsureResult = {
  estDiff: string;
  danielStar: number | null;
};

/** Ensure Daniel dan exists for the given beatmap ids (4K mania only). */
export function ensureDanielDanForIdsSync(
  db: Db,
  ids: string[],
): Map<string, DanielDanEnsureResult> {
  const out = new Map<string, DanielDanEnsureResult>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;

  const placeholders = unique.map(() => "?").join(",");
  const rows = db.$client
    .query(
      `
      SELECT b.id AS id, b.hash AS hash,
             b.ruleset_short_name AS rulesetShortName,
             b.circle_size AS circleSize,
             dr.est_diff AS estDiff,
             dr.sunny_star AS danielStar
      FROM beatmaps b
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE b.id IN (${placeholders})
    `,
    )
    .all(DANIEL_ALGORITHM, ...unique) as Array<{
    id: string;
    hash: string | null;
    rulesetShortName: string | null;
    circleSize: number | null;
    estDiff: string | null;
    danielStar: number | null;
  }>;

  for (const row of rows) {
    if (row.estDiff) {
      out.set(row.id, {
        estDiff: row.estDiff,
        danielStar: row.danielStar != null ? Number(row.danielStar) : null,
      });
      continue;
    }
    if (!isFourKMania(row.rulesetShortName, row.circleSize)) continue;
    computeOneDanielSync(
      db,
      row.id,
      row.hash,
      row.rulesetShortName,
      row.circleSize,
    );
    const updated = db.$client
      .query(
        `
        SELECT est_diff AS estDiff, sunny_star AS danielStar
        FROM beatmap_dan_ratings
        WHERE beatmap_id = ? AND algorithm = ?
      `,
      )
      .get(row.id, DANIEL_ALGORITHM) as {
      estDiff: string | null;
      danielStar: number | null;
    } | null;
    if (updated?.estDiff) {
      out.set(row.id, {
        estDiff: updated.estDiff,
        danielStar:
          updated.danielStar != null ? Number(updated.danielStar) : null,
      });
    }
  }

  return out;
}

/** Compute Daniel dan for 4K mania maps missing a fresh rating. */
export function backfillDanielDanSync(
  db: Db,
  opts: {
    limit?: number;
    includeFailed?: boolean;
  } = {},
): {
  attempted: number;
  succeeded: number;
  remaining: number;
  computed: number;
} {
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
             b.ruleset_short_name AS ruleset_short_name,
             b.circle_size AS circle_size
      FROM beatmaps b
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND CAST(b.circle_size AS INTEGER) = 4
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
    .all(DANIEL_ALGORITHM, limit) as MissingDanielRow[];

  let succeeded = 0;
  for (const row of missing) {
    computeOneDanielSync(
      db,
      row.id,
      row.hash,
      row.ruleset_short_name,
      row.circle_size,
    );
    const updated = db.$client
      .query(
        `
        SELECT est_diff AS estDiff
        FROM beatmap_dan_ratings
        WHERE beatmap_id = ? AND algorithm = ?
      `,
      )
      .get(row.id, DANIEL_ALGORITHM) as { estDiff: string | null } | null;
    if (updated?.estDiff) succeeded += 1;
  }

  const remainingRow = db.$client
    .query(
      `
      SELECT COUNT(*) AS n
      FROM beatmaps b
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE b.hidden = 0
        AND lower(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND CAST(b.circle_size AS INTEGER) = 4
        AND ${missingClause}
    `,
    )
    .get(DANIEL_ALGORITHM) as { n: number } | null;

  const attempted = missing.length;
  return {
    attempted,
    succeeded,
    remaining: Number(remainingRow?.n ?? 0),
    computed: attempted,
  };
}
