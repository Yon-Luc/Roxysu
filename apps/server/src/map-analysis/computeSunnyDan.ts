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
