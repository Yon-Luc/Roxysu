import { and, eq } from "drizzle-orm";
import { beatmaps, type Db } from "@roxysu/db/client.bun";
import { analyze7kFromOsuText } from "@roxysu/pattern-7k";
import {
  getOrComputePatternAnalysis,
  getOrComputeSunnyDan,
} from "../map-analysis";
import { runSunnyEstimatorFromText } from "../map-analysis/sunnyEstimator";
import { parseScoreMods } from "../replay/mods";
import type {
  TosuLiveAnalysis,
  TosuLiveBeatmap,
  TosuLivePattern,
  TosuLiveSunny,
} from "./types";

async function lookupBeatmapId(
  db: Db,
  checksum: string | null,
  onlineId: number | null,
): Promise<string | null> {
  if (checksum) {
    const [byMd5] = await db
      .select({ id: beatmaps.id })
      .from(beatmaps)
      .where(eq(beatmaps.md5Hash, checksum))
      .limit(1);
    if (byMd5) return byMd5.id;
  }

  if (onlineId != null && onlineId > 0) {
    const [byOnline] = await db
      .select({ id: beatmaps.id })
      .from(beatmaps)
      .where(and(eq(beatmaps.onlineId, onlineId)))
      .limit(1);
    if (byOnline) return byOnline.id;
  }

  return null;
}

async function fetchCurrentOsuText(host: string): Promise<string | null> {
  try {
    const res = await fetch(`http://${host}/files/beatmap/file`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

function speedRateFromMods(mods: string | null): number {
  return parseScoreMods(mods).rate;
}

function sunnyFromDb(
  rating: Awaited<ReturnType<typeof getOrComputeSunnyDan>>,
): TosuLiveSunny | null {
  if (!rating) return null;
  return {
    sunnyStar: rating.sunnyStar,
    estDiff: rating.estDiff,
    lnRatio: rating.lnRatio,
    columnCount: rating.columnCount,
    error: rating.error,
    source: "db",
  };
}

function patternFromDb(
  rating: Awaited<ReturnType<typeof getOrComputePatternAnalysis>>,
): TosuLivePattern | null {
  if (!rating) return null;
  return {
    dominantPattern: rating.dominantPattern,
    secondaryPattern: rating.secondaryPattern,
    confidence: rating.confidence,
    columnCount: rating.columnCount,
    error: rating.error,
    source: "db",
  };
}

function sunnyFromText(
  osuText: string,
  mods: string | null,
): TosuLiveSunny {
  try {
    const result = runSunnyEstimatorFromText(osuText, {
      speedRate: speedRateFromMods(mods),
    });
    return {
      sunnyStar: result.star,
      estDiff: result.estDiff,
      lnRatio: result.lnRatio,
      columnCount: result.columnCount,
      error: null,
      source: "osu-text",
    };
  } catch (err) {
    return {
      sunnyStar: null,
      estDiff: null,
      lnRatio: null,
      columnCount: null,
      error: err instanceof Error ? err.message : String(err),
      source: "osu-text",
    };
  }
}

function patternFromText(osuText: string): TosuLivePattern {
  try {
    const result = analyze7kFromOsuText(osuText);
    return {
      dominantPattern: result.dominantPattern,
      secondaryPattern: result.secondaryPattern,
      confidence: result.confidence,
      columnCount: result.columnCount,
      error: null,
      source: "osu-text",
    };
  } catch (err) {
    return {
      dominantPattern: null,
      secondaryPattern: null,
      confidence: null,
      columnCount: null,
      error: err instanceof Error ? err.message : String(err),
      source: "osu-text",
    };
  }
}

export type AnalyzeLiveMapResult = {
  matchedBeatmapId: string | null;
  analysis: Omit<TosuLiveAnalysis, "analyzing">;
};

/** Resolve the live tosu map to Roxysu analysis (ephemeral; no score writes). */
export async function analyzeLiveMap(
  db: Db,
  host: string,
  beatmap: TosuLiveBeatmap,
): Promise<AnalyzeLiveMapResult> {
  const empty: AnalyzeLiveMapResult = {
    matchedBeatmapId: null,
    analysis: { sunny: null, pattern: null },
  };

  const mode = (beatmap.mode ?? "").toLowerCase();
  const isMania =
    beatmap.modeNumber === 3 || mode.includes("mania") || mode === "osu!mania";

  if (!isMania && beatmap.modeNumber != null && beatmap.modeNumber !== 3) {
    return {
      matchedBeatmapId: null,
      analysis: {
        sunny: {
          sunnyStar: null,
          estDiff: null,
          lnRatio: null,
          columnCount: null,
          error: "Not a mania beatmap",
          source: "osu-text",
        },
        pattern: null,
      },
    };
  }

  const matchedBeatmapId = await lookupBeatmapId(
    db,
    beatmap.checksum,
    beatmap.onlineId,
  );

  if (matchedBeatmapId) {
    const [sunny, pattern] = await Promise.all([
      getOrComputeSunnyDan(db, matchedBeatmapId).catch(() => null),
      getOrComputePatternAnalysis(db, matchedBeatmapId).catch(() => null),
    ]);
    return {
      matchedBeatmapId,
      analysis: {
        sunny: sunnyFromDb(sunny),
        pattern: patternFromDb(pattern),
      },
    };
  }

  const osuText = await fetchCurrentOsuText(host);
  if (!osuText) {
    return empty;
  }

  const sunny = sunnyFromText(osuText, beatmap.mods);
  const keys = sunny.columnCount ?? beatmap.keys;
  const pattern =
    keys === 7 ? patternFromText(osuText) : null;

  return {
    matchedBeatmapId: null,
    analysis: { sunny, pattern },
  };
}
