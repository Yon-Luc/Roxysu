import type { Db } from "@roxysu/db/types";
import { beatmapDanRatings, beatmaps } from "@roxysu/db/schema";
import { readFileSync } from "node:fs";
import { eq, and } from "drizzle-orm";

import {
  getOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import { danVariantKey } from "../replay/mods";
import { loadDanVariantRatingsSync } from "./computeDanVariants";
import { runSunnyEstimatorFromText } from "./sunnyEstimator";
import { estDiff } from "./estDiff";
import { toIso as toIsoNullable } from "../shared/serialize";

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
  return toIsoNullable(d) ?? new Date().toISOString();
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

  const filePath = resolveLazerFilePath(beatmap.hash, getOsuDataPath());
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

  const filePath = resolveLazerFilePath(hash, getOsuDataPath());
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

export type SunnyDanEnsureResult = {
  estDiff: string;
  sunnyStar: number | null;
};

/**
 * Ensure Sunny dan exists for the given beatmap ids (mania only).
 * Returns id → rating for maps that have a label after this call.
 */
export function ensureSunnyDanForIdsSync(
  db: Db,
  ids: string[],
): Map<string, SunnyDanEnsureResult> {
  const out = new Map<string, SunnyDanEnsureResult>();
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return out;

  const placeholders = unique.map(() => "?").join(",");
  const rows = db.$client
    .query(
      `
      SELECT b.id AS id, b.hash AS hash,
             b.ruleset_short_name AS rulesetShortName,
             dr.est_diff AS estDiff,
             dr.sunny_star AS sunnyStar
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
    sunnyStar: number | null;
  }>;

  for (const row of rows) {
    if (row.estDiff) {
      out.set(row.id, {
        estDiff: row.estDiff,
        sunnyStar: row.sunnyStar != null ? Number(row.sunnyStar) : null,
      });
      continue;
    }
    if (row.rulesetShortName !== "mania") continue;
    computeOneSunnySync(db, row.id, row.hash, row.rulesetShortName);
    const updated = db.$client
      .query(
        `
        SELECT est_diff AS estDiff, sunny_star AS sunnyStar
        FROM beatmap_dan_ratings
        WHERE beatmap_id = ? AND algorithm = ?
      `,
      )
      .get(row.id, SUNNY_ALGORITHM) as {
      estDiff: string | null;
      sunnyStar: number | null;
    } | null;
    if (updated?.estDiff) {
      out.set(row.id, {
        estDiff: updated.estDiff,
        sunnyStar:
          updated.sunnyStar != null ? Number(updated.sunnyStar) : null,
      });
    }
  }

  return out;
}

export type PatternModSunnyOptions = {
  /** Invert (IN): rice converted to LNs before estimating. */
  invert: boolean;
  /** Hold Off (HO): LNs flattened to rice before estimating. */
  holdOff: boolean;
  /** Playback rate applied by the estimator (1 = nominal map time). */
  speedRate: number;
};

/** Quantize a playback rate the same way as dan variant rows (2 decimals). */
function quantizeVariantRate(rate: number): number {
  return Math.round(rate * 100) / 100;
}

/**
 * Sunny dan rating for an explicit pattern-mod / rate combo.
 * Base combos read the Sunny dan ratings store; modded combos prefer a
 * persisted dan difficulty variants row and otherwise estimate ephemerally.
 * Ephemeral results are never persisted — variant rows are written only by
 * the background job.
 */
export async function getSunnyDanForPatternMods(
  db: Db,
  beatmapId: string,
  options: PatternModSunnyOptions,
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

  const speedRate =
    Number.isFinite(options.speedRate) && options.speedRate > 0
      ? options.speedRate
      : 1;
  const rate = quantizeVariantRate(speedRate);

  if (rate === 1 && !options.invert && !options.holdOff) {
    return getOrComputeSunnyDan(db, beatmapId);
  }

  const now = toIsoNullable(new Date()) ?? new Date().toISOString();

  const fail = (message: string): SunnyDanRating => ({
    algorithm: SUNNY_ALGORITHM,
    beatmapHash: beatmap.hash,
    sunnyStar: null,
    lnRatio: null,
    columnCount: null,
    estDiff: null,
    error: message,
    updatedAt: now,
    cached: false,
  });

  if (beatmap.rulesetShortName !== "mania") {
    return fail("Not a mania beatmap");
  }

  if (!beatmap.hash) {
    return fail("Beatmap hash missing");
  }

  const filePath = resolveLazerFilePath(beatmap.hash, getOsuDataPath());
  if (!filePath) {
    return fail("Could not resolve lazer file path");
  }

  let osuText: string;
  try {
    osuText = readFileSync(filePath, "utf8");
  } catch {
    return fail("Beatmap file not found in lazer files store");
  }

  // Prefer a persisted dan difficulty variants row when the combo is exactly
  // one (Invert-only plays are what the variants store rates).
  if (options.invert && !options.holdOff) {
    const stored = loadDanVariantRatingsSync(db, [beatmapId], SUNNY_ALGORITHM).get(
      danVariantKey(beatmapId, { rate, lnOnly: true }),
    );
    if (stored) {
      return {
        algorithm: SUNNY_ALGORITHM,
        beatmapHash: stored.beatmapHash,
        sunnyStar: stored.star,
        lnRatio: stored.lnRatio,
        columnCount: stored.columnCount,
        estDiff: stored.estDiff,
        error: null,
        updatedAt: now,
        cached: true,
      };
    }
  }

  const cvtParts = [
    options.invert ? "IN" : null,
    options.holdOff ? "HO" : null,
  ].filter(Boolean);

  try {
    const result = runSunnyEstimatorFromText(osuText, {
      speedRate: rate,
      cvtFlag: cvtParts.length > 0 ? cvtParts.join(",") : null,
    });
    return {
      algorithm: SUNNY_ALGORITHM,
      beatmapHash: beatmap.hash,
      sunnyStar: result.star,
      lnRatio: result.lnRatio,
      columnCount: result.columnCount,
      estDiff: result.estDiff,
      error: null,
      updatedAt: now,
      cached: false,
    };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Re-apply current RC/LN label rules to cached Sunny ratings (no .osu re-read).
 * Used after threshold/rule changes (e.g. 20% LN split).
 */export function relabelSunnyDanSync(db: Db): number {
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
 *
 * By default prefers never-attempted / stale-hash maps and skips permanent
 * failures so a full backfill cannot get stuck reprocessing the same errors.
 */
export function backfillSunnyDanSync(
  db: Db,
  opts: {
    limit?: number;
    /** Also retry rows that previously failed (est_diff null). Default false. */
    includeFailed?: boolean;
    /** Skip relabel pass (job already relabels once at start). */
    skipRelabel?: boolean;
  } = {},
): {
  /** Rows selected this batch. */
  attempted: number;
  /** Rows that ended with a non-null est_diff after this batch. */
  succeeded: number;
  remaining: number;
  relabeled: number;
  /** @deprecated alias of attempted — kept for older call sites */
  computed: number;
} {
  const relabeled = opts.skipRelabel ? 0 : relabelSunnyDanSync(db);
  const limit = Math.max(1, Math.min(500, opts.limit ?? 80));
  const includeFailed = opts.includeFailed === true;

  // Prefer never-attempted, then stale hash, then (optionally) prior failures.
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
      SELECT b.id AS id, b.hash AS hash, b.ruleset_short_name AS ruleset_short_name
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
    .all(SUNNY_ALGORITHM, limit) as MissingSunnyRow[];

  let succeeded = 0;
  for (const row of missing) {
    computeOneSunnySync(db, row.id, row.hash, row.ruleset_short_name);
    const updated = db.$client
      .query(
        `
        SELECT est_diff AS estDiff
        FROM beatmap_dan_ratings
        WHERE beatmap_id = ? AND algorithm = ?
      `,
      )
      .get(row.id, SUNNY_ALGORITHM) as { estDiff: string | null } | null;
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
        AND ${missingClause}
    `,
    )
    .get(SUNNY_ALGORITHM) as { n: number } | null;

  const attempted = missing.length;
  return {
    attempted,
    succeeded,
    remaining: Number(remainingRow?.n ?? 0),
    relabeled,
    computed: attempted,
  };
}
