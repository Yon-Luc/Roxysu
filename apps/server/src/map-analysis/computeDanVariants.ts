import type { Db } from "@roxysu/db/types";
import { readFileSync } from "node:fs";

import {
  getOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import {
  danVariantKey,
  resolveDanVariant,
  type DanVariant,
} from "../replay/mods";
import { runSunnyEstimatorFromText } from "./sunnyEstimator";
import { runDanielEstimatorFromText } from "./danielEstimator";
import { yieldForBackfill } from "./jobYield";

export const DAN_VARIANTS_ALGORITHM_SUNNY = "sunny";
export const DAN_VARIANTS_ALGORITHM_DANIEL = "daniel";

export type DanVariantCombo = {
  beatmapId: string;
  rate: number;
  lnOnly: boolean;
};

export type DanVariantRatingRow = {
  beatmapId: string;
  algorithm: string;
  rate: number;
  lnOnly: boolean;
  beatmapHash: string | null;
  star: number | null;
  lnRatio: number | null;
  columnCount: number | null;
  estDiff: string | null;
  error: string | null;
};

type ScoreModsRow = {
  beatmapId: string | null;
  mods: string | null;
};

/**
 * Distinct modded-play combos (beatmap × rate × LN conversion) among mania
 * scores, optionally restricted to the given score ids.
 */
export function collectDanVariantCombos(
  db: Db,
  scoreIds?: string[],
): DanVariantCombo[] {
  const rows =
    scoreIds != null
      ? scoreIds.length === 0
        ? []
        : (db.$client
            .query(
              `
              SELECT s.beatmap_id AS beatmapId, s.mods AS mods
              FROM scores s
              JOIN beatmaps b ON b.id = s.beatmap_id
              WHERE s.delete_pending = 0
                AND s.beatmap_id IS NOT NULL
                AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
                AND s.id IN (${scoreIds.map(() => "?").join(",")})
            `,
            )
            .all(...scoreIds) as ScoreModsRow[])
      : (db.$client
          .query(
            `
            SELECT s.beatmap_id AS beatmapId, s.mods AS mods
            FROM scores s
            JOIN beatmaps b ON b.id = s.beatmap_id
            WHERE s.delete_pending = 0
              AND s.beatmap_id IS NOT NULL
              AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
          `,
          )
          .all() as ScoreModsRow[]);

  const byKey = new Map<string, DanVariantCombo>();
  for (const row of rows) {
    if (!row.beatmapId) continue;
    const variant = resolveDanVariant(row.mods);
    if (!variant) continue;
    byKey.set(danVariantKey(row.beatmapId, variant), {
      beatmapId: row.beatmapId,
      ...variant,
    });
  }
  return [...byKey.values()];
}

function upsertVariantSync(
  db: Db,
  algorithm: string,
  combo: DanVariantCombo,
  values: {
    beatmapHash: string | null;
    star: number | null;
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
      INSERT INTO beatmap_dan_rating_variants (
        beatmap_id, algorithm, rate, ln_only, beatmap_hash, sunny_star,
        ln_ratio, column_count, est_diff, error, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(beatmap_id, algorithm, rate, ln_only) DO UPDATE SET
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
      combo.beatmapId,
      algorithm,
      combo.rate,
      combo.lnOnly ? 1 : 0,
      values.beatmapHash,
      values.star,
      values.lnRatio,
      values.columnCount,
      values.estDiff,
      values.error,
      values.updatedAtMs,
    );
}

type VariantBeatmapRow = {
  hash: string | null;
  rulesetShortName: string | null;
  circleSize: number | null;
};

function computeOneComboSync(
  db: Db,
  combo: DanVariantCombo,
  beatmap: VariantBeatmapRow,
  algorithms: Array<"sunny" | "daniel">,
): void {
  const now = Date.now();

  const fail = (message: string) => {
    for (const algorithm of algorithms) {
      upsertVariantSync(db, algorithm, combo, {
        beatmapHash: beatmap.hash,
        star: null,
        lnRatio: null,
        columnCount: null,
        estDiff: null,
        error: message,
        updatedAtMs: now,
      });
    }
  };

  if (!beatmap.hash) {
    fail("Beatmap hash missing");
    return;
  }

  const filePath = resolveLazerFilePath(beatmap.hash, getOsuDataPath());
  if (!filePath) {
    fail("Could not resolve lazer file path");
    return;
  }

  let osuText: string;
  try {
    osuText = readFileSync(filePath, "utf8");
  } catch {
    fail("Beatmap file not found in lazer files store");
    return;
  }

  const options = {
    speedRate: combo.rate,
    cvtFlag: combo.lnOnly ? "IN" : null,
  };

  try {
    if (algorithms.includes("sunny")) {
      const result = runSunnyEstimatorFromText(osuText, options);
      upsertVariantSync(db, "sunny", combo, {
        beatmapHash: beatmap.hash,
        star: result.star,
        lnRatio: result.lnRatio,
        columnCount: result.columnCount,
        estDiff: result.estDiff,
        error: null,
        updatedAtMs: now,
      });
    }
  } catch (err) {
    upsertVariantSync(db, "sunny", combo, {
      beatmapHash: beatmap.hash,
      star: null,
      lnRatio: null,
      columnCount: null,
      estDiff: null,
      error: err instanceof Error ? err.message : String(err),
      updatedAtMs: now,
    });
  }

  if (algorithms.includes("daniel")) {
    try {
      const result = runDanielEstimatorFromText(osuText, options);
      upsertVariantSync(db, "daniel", combo, {
        beatmapHash: beatmap.hash,
        star: result.star,
        lnRatio: result.lnRatio,
        columnCount: result.columnCount,
        estDiff: result.estDiff,
        error: null,
        updatedAtMs: now,
      });
    } catch (err) {
      upsertVariantSync(db, "daniel", combo, {
        beatmapHash: beatmap.hash,
        star: null,
        lnRatio: null,
        columnCount: null,
        estDiff: null,
        error: err instanceof Error ? err.message : String(err),
        updatedAtMs: now,
      });
    }
  }
}

function variantRowFor(
  db: Db,
  algorithm: string,
  combo: DanVariantCombo,
): { beatmapHash: string | null; estDiff: string | null } | null {
  return (db.$client
    .query(
      `
      SELECT beatmap_hash AS beatmapHash, est_diff AS estDiff
      FROM beatmap_dan_rating_variants
      WHERE beatmap_id = ? AND algorithm = ?
        AND rate = ? AND ln_only = ?
    `,
    )
    .get(combo.beatmapId, algorithm, combo.rate, combo.lnOnly ? 1 : 0) as {
    beatmapHash: string | null;
    estDiff: string | null;
  } | null);
}

type PlannedCombo = {
  combo: DanVariantCombo;
  beatmap: VariantBeatmapRow;
  algorithms: Array<"sunny" | "daniel">;
};

export type DanVariantBackfillResult = {
  attempted: number;
  succeeded: number;
  remaining: number;
  /** True when `shouldContinue` stopped the batch before every combo ran. */
  stoppedEarly: boolean;
  /**
   * Combos that were computed this call (a subset of the attempted combos when
   * `stoppedEarly`). Combos skipped as already fresh are not listed.
   */
  processed: DanVariantCombo[];
};

export type DanVariantBackfillOptions = {
  limit?: number;
  combos?: DanVariantCombo[];
  /** Checked before each combo; return false to stop the batch early. */
  shouldContinue?: () => boolean;
};

/** Pick the combos in `candidates` that still need a sunny/daniel variant row. */
function planDanVariantBackfill(
  db: Db,
  candidates: DanVariantCombo[],
  limit: number,
): PlannedCombo[] {
  const planned: PlannedCombo[] = [];

  for (const combo of candidates) {
    if (planned.length >= limit) break;

    const [beatmap] = db.$client
      .query(
        `
        SELECT hash AS hash,
               ruleset_short_name AS rulesetShortName,
               circle_size AS circleSize
        FROM beatmaps
        WHERE id = ?
      `,
      )
      .all(combo.beatmapId) as VariantBeatmapRow[];
    if (!beatmap) continue;

    const algorithms: Array<"sunny" | "daniel"> = [];
    const sunny = variantRowFor(db, "sunny", combo);
    if (
      !sunny ||
      (sunny.beatmapHash !== null && sunny.beatmapHash !== beatmap.hash)
    ) {
      algorithms.push("sunny");
    }
    const isFourK =
      beatmap.rulesetShortName === "mania" &&
      beatmap.circleSize != null &&
      Math.round(Number(beatmap.circleSize)) === 4;
    if (isFourK) {
      const daniel = variantRowFor(db, "daniel", combo);
      if (
        !daniel ||
        (daniel.beatmapHash !== null && daniel.beatmapHash !== beatmap.hash)
      ) {
        algorithms.push("daniel");
      }
    }
    if (algorithms.length === 0) continue;

    planned.push({ combo, beatmap, algorithms });
  }

  return planned;
}

/** Compute one planned combo; true when a usable label was stored. */
function runPlannedCombo(db: Db, item: PlannedCombo): boolean {
  const { combo, beatmap, algorithms } = item;
  computeOneComboSync(db, combo, beatmap, algorithms);
  const after = variantRowFor(db, "sunny", combo);
  const danielAfter = algorithms.includes("daniel")
    ? variantRowFor(db, "daniel", combo)
    : after;
  return Boolean(after?.estDiff || danielAfter?.estDiff);
}

/**
 * Compute missing/stale dan variants for a batch of played-mods combos.
 * Rows that already succeeded for the current beatmap hash are skipped.
 *
 * Synchronous: it holds the event loop for the whole batch. Background jobs
 * use {@link backfillDanVariants}, which yields between combos.
 */
export function backfillDanVariantsSync(
  db: Db,
  opts: DanVariantBackfillOptions = {},
): DanVariantBackfillResult {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 40));
  const candidates = opts.combos ?? collectDanVariantCombos(db);
  const planned = planDanVariantBackfill(db, candidates, limit);

  let succeeded = 0;
  let stoppedEarly = false;
  const processed: DanVariantCombo[] = [];
  for (const item of planned) {
    if (opts.shouldContinue && !opts.shouldContinue()) {
      stoppedEarly = true;
      break;
    }
    if (runPlannedCombo(db, item)) succeeded += 1;
    processed.push(item.combo);
  }

  const remaining = Math.max(0, candidates.length - processed.length);
  return {
    attempted: planned.length,
    succeeded,
    remaining,
    stoppedEarly,
    processed,
  };
}

/**
 * Same as {@link backfillDanVariantsSync}, but hands the event loop a turn
 * after every combo (and forces a periodic collection) so a modded library
 * cannot stall API responses. `shouldContinue` is checked before each combo.
 */
export async function backfillDanVariants(
  db: Db,
  opts: DanVariantBackfillOptions & {
    /** Override the per-combo yield (tests). */
    yieldBetween?: () => Promise<void>;
  } = {},
): Promise<DanVariantBackfillResult> {
  const limit = Math.max(1, Math.min(500, opts.limit ?? 40));
  const candidates = opts.combos ?? collectDanVariantCombos(db);
  const planned = planDanVariantBackfill(db, candidates, limit);
  const yieldState = { count: 0 };
  const yieldBetween =
    opts.yieldBetween ?? (() => yieldForBackfill(yieldState));

  let succeeded = 0;
  let stoppedEarly = false;
  const processed: DanVariantCombo[] = [];
  for (const item of planned) {
    if (opts.shouldContinue && !opts.shouldContinue()) {
      stoppedEarly = true;
      break;
    }
    if (runPlannedCombo(db, item)) succeeded += 1;
    processed.push(item.combo);
    await yieldBetween();
  }

  const remaining = Math.max(0, candidates.length - processed.length);
  return {
    attempted: planned.length,
    succeeded,
    remaining,
    stoppedEarly,
    processed,
  };
}

/**
 * Load persisted variant ratings for the given beatmaps/algorithm,
 * keyed by {@link danVariantKey} (only rows with a usable label).
 */
export function loadDanVariantRatingsSync(
  db: Db,
  beatmapIds: string[],
  algorithm: string,
): Map<string, DanVariantRatingRow> {
  const out = new Map<string, DanVariantRatingRow>();
  const unique = [...new Set(beatmapIds.filter(Boolean))];
  if (unique.length === 0) return out;

  for (let i = 0; i < unique.length; i += 400) {
    const chunk = unique.slice(i, i + 400);
    const rows = db.$client
      .query(
        `
        SELECT beatmap_id AS beatmapId, rate AS rate, ln_only AS lnOnly,
               beatmap_hash AS beatmapHash, sunny_star AS star,
               ln_ratio AS lnRatio, column_count AS columnCount,
               est_diff AS estDiff, error AS error
        FROM beatmap_dan_rating_variants
        WHERE algorithm = ?
          AND beatmap_id IN (${chunk.map(() => "?").join(",")})
          AND est_diff IS NOT NULL
          AND error IS NULL
          AND sunny_star IS NOT NULL
          AND ln_ratio IS NOT NULL
          AND column_count IS NOT NULL
      `,
      )
      .all(algorithm, ...chunk) as Array<{
      beatmapId: string;
      rate: number;
      lnOnly: number;
      beatmapHash: string | null;
      star: number;
      lnRatio: number;
      columnCount: number;
      estDiff: string;
      error: string | null;
    }>;

    for (const row of rows) {
      const variant: DanVariant = {
        rate: Number(row.rate),
        lnOnly: row.lnOnly === 1,
      };
      out.set(danVariantKey(row.beatmapId, variant), {
        beatmapId: row.beatmapId,
        algorithm,
        rate: variant.rate,
        lnOnly: variant.lnOnly,
        beatmapHash: row.beatmapHash,
        star: Number(row.star),
        lnRatio: Number(row.lnRatio),
        columnCount: Number(row.columnCount),
        estDiff: row.estDiff,
        error: row.error,
      });
    }
  }

  return out;
}
