import type { Db } from "@roxysu/db/types";
import { beatmaps } from "@roxysu/db/schema";
import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { parseScoreMods } from "@roxysu/mania-judge/mods";

import { analyzeManiaFromOsuText } from "@roxysu/mania-pattern-analysis";
import {
  analyzeManiaPatternDetail,
  getOrComputePatternAnalysis,
  PATTERN_ALGORITHM,
  type ManiaPatternDetail,
} from "../map-analysis";
import { runDanielEstimatorFromText } from "../map-analysis/danielEstimator";
import {
  getOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import type {
  TosuLiveAnalysis,
  TosuLiveBeatmap,
  TosuLivePattern,
  TosuLiveSunny,
} from "./types";

async function lookupBeatmap(
  db: Db,
  checksum: string | null,
  onlineId: number | null,
): Promise<{ id: string; backgroundFileHash: string | null } | null> {
  if (checksum) {
    const [byMd5] = await db
      .select({
        id: beatmaps.id,
        backgroundFileHash: beatmaps.backgroundFileHash,
      })
      .from(beatmaps)
      .where(eq(beatmaps.md5Hash, checksum))
      .limit(1);
    if (byMd5) return byMd5;
  }

  if (onlineId != null && onlineId > 0) {
    const [byOnline] = await db
      .select({
        id: beatmaps.id,
        backgroundFileHash: beatmaps.backgroundFileHash,
      })
      .from(beatmaps)
      .where(and(eq(beatmaps.onlineId, onlineId)))
      .limit(1);
    if (byOnline) return byOnline;
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

async function readOsuTextFromDb(
  db: Db,
  beatmapId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ hash: beatmaps.hash })
    .from(beatmaps)
    .where(eq(beatmaps.id, beatmapId))
    .limit(1);
  if (!row?.hash) return null;
  try {
    const path = resolveLazerFilePath(row.hash, getOsuDataPath());
    if (path == null) return null;
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
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

/**
 * Estimator `cvtFlag` ("IN", "HO", "IN,HO") for a lazer mods JSON string.
 * Null when no pattern conversion is active — Mirror/Classic don't convert.
 */
export function conversionCvtFlag(
  mods: string | null | undefined,
): string | null {
  const parsed = parseScoreMods(mods);
  const parts = [
    parsed.invert ? "IN" : null,
    parsed.holdOff ? "HO" : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(",") : null;
}

function sunnyFromText(
  osuText: string,
  speedRate: number,
  cvtFlag: string | null,
): TosuLiveSunny {
  try {
    const result = runDanielEstimatorFromText(osuText, { speedRate, cvtFlag });
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
    const result = analyzeManiaFromOsuText(osuText);
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
  backgroundFileHash: string | null;
  analysis: Omit<TosuLiveAnalysis, "analyzing">;
  /** Full mania pattern detail (composition + density samples); null for non-mania. */
  patternDetail: ManiaPatternDetail | null;
};

export type AnalyzeLiveMapOptions = {
  /** Cached `.osu` text for the current checksum (avoids re-fetch on rate tweaks). */
  osuTextCache?: string | null;
  /** When true, skip pattern recompute (rate-only change). */
  sunnyOnly?: boolean;
  /** Previous pattern to keep when sunnyOnly. */
  previousPattern?: TosuLivePattern | null;
  /** Previous full pattern detail to keep when sunnyOnly. */
  previousPatternDetail?: ManiaPatternDetail | null;
};

function patternDetailFromText(osuText: string): ManiaPatternDetail | null {
  try {
    return analyzeManiaPatternDetail(osuText);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/not mania/i.test(message)) return null;
    return {
      algorithm: PATTERN_ALGORITHM,
      columnCount: null,
      noteCount: 0,
      holdCount: 0,
      durationMs: 0,
      averageNps: 0,
      peakNps: 0,
      peakChordSize: 0,
      dominantPattern: null,
      secondaryPattern: null,
      confidence: null,
      composition: {
        jack: 0,
        chordjack: 0,
        delay: 0,
        chordstream: 0,
        bracket: 0,
        jumpstream: 0,
        handstream: 0,
        stream: 0,
      },
      samples: [],
      hotspots: [],
      error: message,
    };
  }
}

/** Resolve the live tosu map to Roxysu analysis (ephemeral; rate-aware Sunny). */
export async function analyzeLiveMap(
  db: Db,
  host: string,
  beatmap: TosuLiveBeatmap,
  options: AnalyzeLiveMapOptions = {},
): Promise<AnalyzeLiveMapResult & { osuText: string | null }> {
  const empty = {
    matchedBeatmapId: null as string | null,
    backgroundFileHash: null as string | null,
    analysis: { sunny: null, pattern: null } as Omit<
      TosuLiveAnalysis,
      "analyzing"
    >,
    patternDetail: null as ManiaPatternDetail | null,
    osuText: null as string | null,
  };

  const mode = (beatmap.mode ?? "").toLowerCase();
  const isMania =
    beatmap.modeNumber === 3 || mode.includes("mania") || mode === "osu!mania";

  const matched = await lookupBeatmap(db, beatmap.checksum, beatmap.onlineId);
  const matchedBeatmapId = matched?.id ?? null;
  const backgroundFileHash = matched?.backgroundFileHash ?? null;

  // Sunny/pattern analysis is mania-only, but still resolve library id for preview.
  if (!isMania && beatmap.modeNumber != null && beatmap.modeNumber !== 3) {
    return {
      matchedBeatmapId,
      backgroundFileHash,
      analysis: { sunny: null, pattern: null },
      patternDetail: null,
      osuText: options.osuTextCache ?? null,
    };
  }

  let osuText = options.osuTextCache ?? null;
  if (!osuText) {
    osuText = await fetchCurrentOsuText(host);
  }
  if (!osuText && matchedBeatmapId) {
    osuText = await readOsuTextFromDb(db, matchedBeatmapId);
  }
  if (!osuText) {
    return { ...empty, matchedBeatmapId, backgroundFileHash };
  }

  const speedRate =
    typeof beatmap.rate === "number" &&
    Number.isFinite(beatmap.rate) &&
    beatmap.rate > 0
      ? beatmap.rate
      : 1;

  const cvtFlag = conversionCvtFlag(beatmap.mods);
  const sunny = sunnyFromText(osuText, speedRate, cvtFlag);

  let pattern: TosuLivePattern | null;
  let patternDetail: ManiaPatternDetail | null;
  if (options.sunnyOnly) {
    pattern = options.previousPattern ?? null;
    patternDetail = options.previousPatternDetail ?? null;
  } else {
    patternDetail = patternDetailFromText(osuText);
    if (matchedBeatmapId) {
      const fromDb = await getOrComputePatternAnalysis(db, matchedBeatmapId).catch(
        () => null,
      );
      pattern = patternFromDb(fromDb);
      if (!pattern) {
        const keys = sunny.columnCount ?? beatmap.keys;
        pattern = keys === 7 ? patternFromText(osuText) : null;
      }
    } else {
      const keys = sunny.columnCount ?? beatmap.keys;
      pattern = keys === 7 ? patternFromText(osuText) : null;
    }
    // Prefer labels from the full structural detail when available.
    if (patternDetail && !patternDetail.error) {
      pattern = {
        dominantPattern: patternDetail.dominantPattern,
        secondaryPattern: patternDetail.secondaryPattern,
        confidence: patternDetail.confidence,
        columnCount: patternDetail.columnCount,
        error: null,
        source: matchedBeatmapId ? "db" : "osu-text",
      };
    }
  }

  return {
    matchedBeatmapId,
    backgroundFileHash,
    analysis: { sunny, pattern },
    patternDetail,
    osuText,
  };
}
