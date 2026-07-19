import { readFileSync } from "node:fs";
import { eq, and } from "drizzle-orm";
import {
  beatmapDanRatings,
  beatmaps,
  type Db,
} from "@roxysu/db/client.bun";
import {
  defaultOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import { runSunnyEstimatorFromText } from "./sunnyEstimator";
import { estDiff } from "./estDiff";

export const SUNNY_ALGORITHM = "sunny";

export type SunnyDanRating = {
  algorithm: typeof SUNNY_ALGORITHM;
  beatmapHash: string | null;
  sunnyStar: number | null;
  lnRatio: number | null;
  columnCount: number | null;
  estDiff: string | null;
  error: string | null;
  updatedAt: string;
  cached: boolean;
};

function toIso(d: Date | null | undefined): string {
  return (d ?? new Date()).toISOString();
}

function rowToResult(
  row: typeof beatmapDanRatings.$inferSelect,
  cached: boolean,
): SunnyDanRating {
  return {
    algorithm: SUNNY_ALGORITHM,
    beatmapHash: row.beatmapHash,
    sunnyStar: row.sunnyStar,
    lnRatio: row.lnRatio,
    columnCount: row.columnCount,
    estDiff: row.estDiff,
    error: row.error,
    updatedAt: toIso(row.updatedAt),
    cached,
  };
}

async function upsertRating(
  db: Db,
  values: typeof beatmapDanRatings.$inferInsert,
): Promise<SunnyDanRating> {
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

/**
 * Return cached Sunny dan rating, or compute from local lazer `.osu` via beatmaps.hash.
 */
export async function getOrComputeSunnyDan(
  db: Db,
  beatmapId: string,
  options: { force?: boolean } = {},
): Promise<SunnyDanRating | null> {
  const [beatmap] = await db
    .select({
      id: beatmaps.id,
      hash: beatmaps.hash,
      rulesetShortName: beatmaps.rulesetShortName,
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
          eq(beatmapDanRatings.algorithm, SUNNY_ALGORITHM),
        ),
      )
      .limit(1);

    if (
      cached &&
      cached.beatmapHash === beatmap.hash &&
      cached.error == null &&
      cached.estDiff != null &&
      cached.sunnyStar != null &&
      cached.lnRatio != null &&
      cached.columnCount != null
    ) {
      const label = estDiff(
        cached.sunnyStar,
        cached.lnRatio,
        cached.columnCount,
      );
      if (label !== cached.estDiff) {
        return upsertRating(db, {
          beatmapId,
          algorithm: SUNNY_ALGORITHM,
          beatmapHash: cached.beatmapHash,
          sunnyStar: cached.sunnyStar,
          lnRatio: cached.lnRatio,
          columnCount: cached.columnCount,
          estDiff: label,
          error: null,
          updatedAt: new Date(),
        });
      }
      return rowToResult(cached, true);
    }

    if (
      cached &&
      cached.beatmapHash === beatmap.hash &&
      cached.error == null &&
      cached.estDiff != null
    ) {
      return rowToResult(cached, true);
    }
  }

  const now = new Date();

  if (beatmap.rulesetShortName !== "mania") {
    return upsertRating(db, {
      beatmapId,
      algorithm: SUNNY_ALGORITHM,
      beatmapHash: beatmap.hash,
      sunnyStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Not a mania beatmap",
      updatedAt: now,
    });
  }

  if (!beatmap.hash) {
    return upsertRating(db, {
      beatmapId,
      algorithm: SUNNY_ALGORITHM,
      beatmapHash: null,
      sunnyStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Beatmap hash missing",
      updatedAt: now,
    });
  }

  const filePath = resolveLazerFilePath(beatmap.hash, defaultOsuDataPath());
  if (!filePath) {
    return upsertRating(db, {
      beatmapId,
      algorithm: SUNNY_ALGORITHM,
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
      algorithm: SUNNY_ALGORITHM,
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
    const result = runSunnyEstimatorFromText(osuText);
    return upsertRating(db, {
      beatmapId,
      algorithm: SUNNY_ALGORITHM,
      beatmapHash: beatmap.hash,
      sunnyStar: result.star,
      lnRatio: result.lnRatio,
      columnCount: result.columnCount,
      estDiff: result.estDiff,
      error: null,
      updatedAt: now,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return upsertRating(db, {
      beatmapId,
      algorithm: SUNNY_ALGORITHM,
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

type MissingSunnyRow = {
  id: string;
  hash: string | null;
  ruleset_short_name: string | null;
};

function upsertRatingSync(
  db: Db,
  values: {
    beatmapId: string;
    beatmapHash: string | null;
    sunnyStar: number | null;
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
      SUNNY_ALGORITHM,
      values.beatmapHash,
      values.sunnyStar,
      values.lnRatio,
      values.columnCount,
      values.estDiff,
      values.error,
      values.updatedAtMs,
    );
}

function computeOneSunnySync(
  db: Db,
  beatmapId: string,
  hash: string | null,
  rulesetShortName: string | null,
): void {
  const now = Date.now();

  if (rulesetShortName !== "mania") {
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      sunnyStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Not a mania beatmap",
      updatedAtMs: now,
    });
    return;
  }

  if (!hash) {
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: null,
      sunnyStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Beatmap hash missing",
      updatedAtMs: now,
    });
    return;
  }

  const filePath = resolveLazerFilePath(hash, defaultOsuDataPath());
  if (!filePath) {
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      sunnyStar: null,
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
      sunnyStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: "Beatmap file not found in lazer files store",
      updatedAtMs: now,
    });
    return;
  }

  try {
    const result = runSunnyEstimatorFromText(osuText);
    upsertRatingSync(db, {
      beatmapId,
      beatmapHash: hash,
      sunnyStar: result.star,
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
      sunnyStar: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: message,
      updatedAtMs: now,
    });
  }
}

/**
 * Ensure Sunny dan exists for the given beatmap ids (mania only).
 * Returns id → estDiff for maps that have a label after this call.
 */
export function ensureSunnyDanForIdsSync(
  db: Db,
  ids: string[],
): Map<string, string> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;

  const placeholders = unique.map(() => "?").join(",");
  const rows = db.$client
    .query(
      `
      SELECT b.id AS id, b.hash AS hash,
             b.ruleset_short_name AS rulesetShortName,
             dr.est_diff AS estDiff
      FROM beatmaps b
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE b.id IN (${placeholders})
    `,
    )
    .all(SUNNY_ALGORITHM, ...unique) as Array<{
    id: string;
    hash: string | null;
    rulesetShortName: string | null;
    estDiff: string | null;
  }>;

  for (const row of rows) {
    if (row.estDiff) {
      out.set(row.id, row.estDiff);
      continue;
    }
    if (row.rulesetShortName !== "mania") continue;
    computeOneSunnySync(db, row.id, row.hash, row.rulesetShortName);
    const updated = db.$client
      .query(
        `
        SELECT est_diff AS estDiff
        FROM beatmap_dan_ratings
        WHERE beatmap_id = ? AND algorithm = ?
      `,
      )
      .get(row.id, SUNNY_ALGORITHM) as { estDiff: string | null } | null;
    if (updated?.estDiff) out.set(row.id, updated.estDiff);
  }

  return out;
}

/**
 * Re-apply current RC/LN label rules to cached Sunny ratings (no .osu re-read).
 * Used after threshold/rule changes (e.g. 20% LN split).
 */
export function relabelSunnyDanSync(db: Db): number {
  const rows = db.$client
    .query(
      `
      SELECT beatmap_id AS beatmapId, sunny_star AS sunnyStar,
             ln_ratio AS lnRatio, column_count AS columnCount, est_diff AS estDiff
      FROM beatmap_dan_ratings
      WHERE algorithm = ?
        AND sunny_star IS NOT NULL
        AND ln_ratio IS NOT NULL
        AND column_count IS NOT NULL
        AND error IS NULL
    `,
    )
    .all(SUNNY_ALGORITHM) as Array<{
    beatmapId: string;
    sunnyStar: number;
    lnRatio: number;
    columnCount: number;
    estDiff: string | null;
  }>;

  const now = Date.now();
  let updated = 0;
  for (const row of rows) {
    const next = estDiff(row.sunnyStar, row.lnRatio, row.columnCount);
    if (next === row.estDiff) continue;
    db.$client
      .query(
        `
        UPDATE beatmap_dan_ratings
        SET est_diff = ?, updated_at = ?
        WHERE beatmap_id = ? AND algorithm = ?
      `,
      )
      .run(next, now, row.beatmapId, SUNNY_ALGORITHM);
    updated += 1;
  }
  return updated;
}

/**
 * Compute Sunny dan for mania maps missing a fresh rating.
 * Sync so query-language search can fill coverage before filtering.
 */
export function backfillSunnyDanSync(
  db: Db,
  opts: { limit?: number } = {},
): { computed: number; remaining: number; relabeled: number } {
  const relabeled = relabelSunnyDanSync(db);
  const limit = Math.max(1, Math.min(500, opts.limit ?? 80));

  const missing = db.$client
    .query(
      `
      SELECT b.id AS id, b.hash AS hash, b.ruleset_short_name AS ruleset_short_name
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
      LIMIT ?
    `,
    )
    .all(SUNNY_ALGORITHM, limit) as MissingSunnyRow[];

  for (const row of missing) {
    computeOneSunnySync(db, row.id, row.hash, row.ruleset_short_name);
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

  return {
    computed: missing.length,
    remaining: Number(remainingRow?.n ?? 0),
    relabeled,
  };
}
