
import type { Db } from "@roxysu/db/types";
import {
  backfillSunnyDanSync,
  ensureSunnyDanForIdsSync,
} from "../../map-analysis/computeSunnyDan";
import { classifyMapAxis } from "./axis";
import type { MapAxis, SevenKSkillProfile, SkillAxis } from "./types";

/** Min plays before we trust the comfort estimate (else cold-start). */
const MIN_PLAYS_FOR_SKILL = 5;

/** Default number of top-rated plays used for skill bands. */
export const DEFAULT_SKILL_TOP_PLAYS = 30;

/** Push band: solid clears that are not farm yet. */
const PUSH_ACC_MIN = 0.9;
const PUSH_ACC_MAX = 0.95;
const PUSH_ACC_CENTER = 0.925;

/** Consistency band: high-acc farm / polish level. */
const CONSISTENCY_ACC_MIN = 0.96;
const CONSISTENCY_ACC_MAX = 0.99;
const CONSISTENCY_ACC_CENTER = 0.975;

/** Accuracy band: 99%+ targets. */
const ACCURACY_ACC_MIN = 0.99;
const ACCURACY_ACC_MAX = 1.01;
const ACCURACY_ACC_CENTER = 0.995;

/** Recency decay per play index (Companella uses 0.95). */
const RECENCY_DECAY = 0.95;

export type SkillPlayRow = {
  beatmapId: string;
  accuracy: number;
  playedAt: number;
  sunnyStar: number | null;
  lnRatio: number | null;
};

type ClearMapRow = {
  beatmapId: string;
  sunnyStar: number;
  lnRatio: number | null;
  bandPlays: number;
  avgBandAcc: number;
  lastPlayedAt: number;
};

export type SkillHistoryPoint = {
  /** ISO day (YYYY-MM-DD) or week start Monday. */
  at: string;
  push: number;
  accuracy: number;
  consistency: number;
  pushRc: number;
  pushLn: number;
  pushFln: number;
  accuracyRc: number;
  accuracyLn: number;
  accuracyFln: number;
  consistencyRc: number;
  consistencyLn: number;
  consistencyFln: number;
  overall: number;
  rc: number;
  ln: number;
  fln: number;
  coldStart: boolean;
};

export type SkillHistoryOptions = {
  granularity: "day" | "week";
  /** Lookback window in days (e.g. 30 / 90 / 180). */
  rangeDays: number;
  /** Top-rated plays per accuracy band (default 30). */
  topPlays?: number;
};

export type SevenKSkillOptions = {
  /** Top-rated plays per accuracy band and for comfort (default 30). */
  topPlays?: number;
};

export type SkillBandKind = "push" | "accuracy" | "consistency";

export function skillBandAccRange(
  band: SkillBandKind,
): { min: number; max: number } {
  switch (band) {
    case "push":
      return { min: PUSH_ACC_MIN, max: PUSH_ACC_MAX };
    case "consistency":
      return { min: CONSISTENCY_ACC_MIN, max: CONSISTENCY_ACC_MAX };
    case "accuracy":
      return { min: ACCURACY_ACC_MIN, max: ACCURACY_ACC_MAX };
  }
}

/** Accuracy weight: 80% → 0, 100% → 1 (accuracy stored 0–1). */
function accuracyWeight(accuracy: number): number {
  return Math.max(0, (accuracy * 100 - 80) / 20);
}

function weightedMean(
  points: Array<{ value: number; weight: number }>,
): number {
  if (points.length === 0) return 0;
  const totalWeight = points.reduce((s, p) => s + p.weight, 0);
  if (totalWeight <= 0) {
    return points.reduce((s, p) => s + p.value, 0) / points.length;
  }
  return points.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight;
}

function emptySkill(partial: Partial<SevenKSkillProfile> = {}): SevenKSkillProfile {
  return {
    overall: 0,
    rc: 0,
    ln: 0,
    fln: 0,
    peakOverall: 0,
    peakRc: 0,
    peakLn: 0,
    peakFln: 0,
    clearRcMaps: 0,
    clearLnMaps: 0,
    clearFlnMaps: 0,
    accuracyOverall: 0,
    accuracyRc: 0,
    accuracyLn: 0,
    accuracyFln: 0,
    accuracyRcMaps: 0,
    accuracyLnMaps: 0,
    accuracyFlnMaps: 0,
    consistencyOverall: 0,
    consistencyRc: 0,
    consistencyLn: 0,
    consistencyFln: 0,
    consistencyRcMaps: 0,
    consistencyLnMaps: 0,
    consistencyFlnMaps: 0,
    samplePlays: 0,
    rcPlays: 0,
    lnPlays: 0,
    flnPlays: 0,
    coldStart: true,
    ...partial,
  };
}

function normalizeTopPlays(raw: number | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_SKILL_TOP_PLAYS;
  return Math.min(500, Math.max(1, Math.round(n)));
}

/** Parse top-map count from API query strings (stats, recommend, etc.). */
export function parseSkillTopPlays(raw: unknown): number {
  if (raw === undefined) return DEFAULT_SKILL_TOP_PLAYS;
  return normalizeTopPlays(Number(raw));
}

type PlayLike = Pick<
  SkillPlayRow,
  "beatmapId" | "accuracy" | "playedAt" | "sunnyStar"
>;

/** Keep a single best score per beatmap (highest ★, then acc, then newest). */
export function bestPlayPerMap<T extends PlayLike>(plays: T[]): T[] {
  const byMap = new Map<string, T>();
  for (const play of plays) {
    const existing = byMap.get(play.beatmapId);
    if (!existing) {
      byMap.set(play.beatmapId, play);
      continue;
    }
    const playStar = play.sunnyStar ?? 0;
    const existingStar = existing.sunnyStar ?? 0;
    const better =
      playStar > existingStar ||
      (playStar === existingStar &&
        (play.accuracy > existing.accuracy ||
          (play.accuracy === existing.accuracy &&
            play.playedAt > existing.playedAt)));
    if (better) byMap.set(play.beatmapId, play);
  }
  return [...byMap.values()];
}

/** Highest Sunny maps at or above the band floor (one best play per map). */
export function topPlaysInBand(
  plays: SkillPlayRow[],
  accFloor: number,
  topN: number,
  axis?: MapAxis,
): SkillPlayRow[] {
  return bestPlayPerMap(
    plays.filter(
      (p) =>
        p.sunnyStar != null &&
        p.sunnyStar > 0 &&
        p.accuracy >= accFloor &&
        (axis == null || classifyMapAxis(p.lnRatio) === axis),
    ),
  )
    .sort(
      (a, b) =>
        b.sunnyStar! - a.sunnyStar! ||
        b.accuracy - a.accuracy ||
        b.playedAt - a.playedAt ||
        a.beatmapId.localeCompare(b.beatmapId),
    )
    .slice(0, topN);
}

/** Top Sunny-rated plays across all accuracy bands (one play per map). */
function topRatedPlays(plays: SkillPlayRow[], topN: number): SkillPlayRow[] {
  return bestPlayPerMap(
    plays.filter((p) => p.sunnyStar != null && p.sunnyStar > 0),
  )
    .sort(
      (a, b) =>
        b.sunnyStar! - a.sunnyStar! ||
        b.accuracy - a.accuracy ||
        b.playedAt - a.playedAt ||
        a.beatmapId.localeCompare(b.beatmapId),
    )
    .slice(0, topN);
}

/**
 * Maps with at least one score in [accMin, accMax) — used by unit tests.
 */
function aggregateAccBandMaps(
  plays: SkillPlayRow[],
  accMin: number,
  accMax: number,
): ClearMapRow[] {
  const byMap = new Map<
    string,
    {
      sunnyStar: number;
      lnRatio: number | null;
      bandPlays: number;
      accSum: number;
      lastPlayedAt: number;
    }
  >();

  for (const play of plays) {
    if (play.sunnyStar == null || !(play.sunnyStar > 0)) continue;
    if (play.accuracy < accMin || play.accuracy >= accMax) continue;
    const existing = byMap.get(play.beatmapId);
    if (!existing) {
      byMap.set(play.beatmapId, {
        sunnyStar: play.sunnyStar,
        lnRatio: play.lnRatio,
        bandPlays: 1,
        accSum: play.accuracy,
        lastPlayedAt: play.playedAt,
      });
      continue;
    }
    existing.bandPlays += 1;
    existing.accSum += play.accuracy;
    if (play.playedAt > existing.lastPlayedAt) {
      existing.lastPlayedAt = play.playedAt;
    }
    if (play.lnRatio != null) existing.lnRatio = play.lnRatio;
  }

  return [...byMap.entries()].map(([beatmapId, row]) => ({
    beatmapId,
    sunnyStar: row.sunnyStar,
    lnRatio: row.lnRatio,
    bandPlays: row.bandPlays,
    avgBandAcc: row.accSum / row.bandPlays,
    lastPlayedAt: row.lastPlayedAt,
  }));
}

/**
 * Average Sunny of top plays in an accuracy band on an axis.
 * Weight: closeness to band center × mild recency.
 */
function clearLevelFromPlays(
  bandPlays: SkillPlayRow[],
  axis: MapAxis | "all",
  accCenter: number,
  halfWidth: number,
): { level: number; playCount: number } {
  const filtered =
    axis === "all"
      ? bandPlays
      : bandPlays.filter((p) => classifyMapAxis(p.lnRatio) === axis);

  if (filtered.length === 0) return { level: 0, playCount: 0 };

  const newest = Math.max(...filtered.map((p) => p.playedAt));
  const oldest = Math.min(...filtered.map((p) => p.playedAt));
  const span = Math.max(newest - oldest, 1);

  const points: Array<{ value: number; weight: number }> = [];
  for (const play of filtered) {
    if (play.sunnyStar == null || !(play.sunnyStar > 0)) continue;
    const accDist = Math.abs(play.accuracy - accCenter);
    const accProximity = Math.max(0.35, 1 - accDist / Math.max(halfWidth, 0.01));
    const recency = 0.5 + 0.5 * ((play.playedAt - oldest) / span);
    const weight = accProximity * recency;
    points.push({ value: play.sunnyStar, weight });
  }

  return {
    level: weightedMean(points),
    playCount: filtered.length,
  };
}

function bandLevelsFromPlays(
  plays: SkillPlayRow[],
  accFloor: number,
  topN: number,
  center: number,
  halfWidth: number,
) {
  return {
    all: clearLevelFromPlays(
      topPlaysInBand(plays, accFloor, topN),
      "all",
      center,
      halfWidth,
    ),
    rc: clearLevelFromPlays(
      topPlaysInBand(plays, accFloor, topN, "rc"),
      "rc",
      center,
      halfWidth,
    ),
    ln: clearLevelFromPlays(
      topPlaysInBand(plays, accFloor, topN, "ln"),
      "ln",
      center,
      halfWidth,
    ),
    fln: clearLevelFromPlays(
      topPlaysInBand(plays, accFloor, topN, "fln"),
      "fln",
      center,
      halfWidth,
    ),
  };
}

/** Cold start from best-acc per map in the play list (no DB). */
function coldStartFromPlays(plays: SkillPlayRow[]): SevenKSkillProfile {
  const byMap = new Map<
    string,
    { bestAccuracy: number; sunnyStar: number; lnRatio: number | null }
  >();

  for (const play of plays) {
    if (play.sunnyStar == null || !(play.sunnyStar > 0)) continue;
    const existing = byMap.get(play.beatmapId);
    if (!existing || play.accuracy > existing.bestAccuracy) {
      byMap.set(play.beatmapId, {
        bestAccuracy: play.accuracy,
        sunnyStar: play.sunnyStar,
        lnRatio: play.lnRatio,
      });
    }
  }

  const rows = [...byMap.values()]
    .sort((a, b) => b.bestAccuracy - a.bestAccuracy)
    .slice(0, 80);

  const rcPoints: Array<{ value: number; weight: number }> = [];
  const lnPoints: Array<{ value: number; weight: number }> = [];
  const flnPoints: Array<{ value: number; weight: number }> = [];
  const allPoints: Array<{ value: number; weight: number }> = [];

  for (const row of rows) {
    const weight = Math.max(0.05, accuracyWeight(row.bestAccuracy));
    const point = { value: row.sunnyStar, weight };
    allPoints.push(point);
    const axis = classifyMapAxis(row.lnRatio);
    if (axis === "fln") flnPoints.push(point);
    else if (axis === "ln") lnPoints.push(point);
    else rcPoints.push(point);
  }

  const rc = weightedMean(rcPoints);
  const ln = weightedMean(lnPoints);
  const fln = weightedMean(flnPoints);
  const overall = allPoints.length > 0 ? weightedMean(allPoints) : 0;
  const comfortRc = rc > 0 ? rc : overall;
  const comfortLn = ln > 0 ? ln : overall;
  const comfortFln = fln > 0 ? fln : overall;
  return emptySkill({
    overall,
    rc: comfortRc,
    ln: comfortLn,
    fln: comfortFln,
    peakOverall: overall,
    peakRc: comfortRc,
    peakLn: comfortLn,
    peakFln: comfortFln,
    accuracyOverall: overall,
    accuracyRc: comfortRc,
    accuracyLn: comfortLn,
    accuracyFln: comfortFln,
    samplePlays: allPoints.length,
    rcPlays: rcPoints.length,
    lnPlays: lnPoints.length,
    flnPlays: flnPoints.length,
    coldStart: true,
  });
}

/** Cold start: best-acc weighted Sunny on played 7K maps with ratings. */
function coldStartFromMastery(db: Db): SevenKSkillProfile {
  const rows = db.$client
    .query(
      `
      SELECT
        COALESCE(ps.best_accuracy, m.best_accuracy) AS bestAccuracy,
        COALESCE(ps.play_count, m.play_count, 0) AS playCount,
        dr.sunny_star AS sunnyStar,
        dr.ln_ratio AS lnRatio
      FROM beatmaps b
      JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = 'sunny'
      LEFT JOIN mastery m ON m.beatmap_id = b.id
      LEFT JOIN (
        SELECT
          beatmap_id,
          COUNT(*) AS play_count,
          MAX(accuracy) AS best_accuracy
        FROM scores
        WHERE delete_pending = 0 AND beatmap_id IS NOT NULL
        GROUP BY beatmap_id
      ) ps ON ps.beatmap_id = b.id
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      WHERE b.hidden = 0
        AND COALESCE(bs.delete_pending, 0) = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = 7
        AND dr.sunny_star IS NOT NULL
        AND (dr.error IS NULL OR dr.error = '')
        AND COALESCE(ps.play_count, m.play_count, 0) > 0
      ORDER BY COALESCE(ps.best_accuracy, m.best_accuracy, 0) DESC
      LIMIT 80
    `,
    )
    .all() as Array<{
    bestAccuracy: number | null;
    playCount: number;
    sunnyStar: number;
    lnRatio: number | null;
  }>;

  const rcPoints: Array<{ value: number; weight: number }> = [];
  const lnPoints: Array<{ value: number; weight: number }> = [];
  const flnPoints: Array<{ value: number; weight: number }> = [];
  const allPoints: Array<{ value: number; weight: number }> = [];

  for (const row of rows) {
    const sunny = Number(row.sunnyStar);
    if (!Number.isFinite(sunny) || sunny <= 0) continue;
    const acc = Number(row.bestAccuracy ?? 0);
    const weight = Math.max(0.05, accuracyWeight(acc));
    const point = { value: sunny, weight };
    allPoints.push(point);
    const axis = classifyMapAxis(
      row.lnRatio != null ? Number(row.lnRatio) : null,
    );
    if (axis === "fln") flnPoints.push(point);
    else if (axis === "ln") lnPoints.push(point);
    else rcPoints.push(point);
  }

  const rc = weightedMean(rcPoints);
  const ln = weightedMean(lnPoints);
  const fln = weightedMean(flnPoints);
  const overall = allPoints.length > 0 ? weightedMean(allPoints) : 0;
  const comfortRc = rc > 0 ? rc : overall;
  const comfortLn = ln > 0 ? ln : overall;
  const comfortFln = fln > 0 ? fln : overall;
  return emptySkill({
    overall,
    rc: comfortRc,
    ln: comfortLn,
    fln: comfortFln,
    peakOverall: overall,
    peakRc: comfortRc,
    peakLn: comfortLn,
    peakFln: comfortFln,
    accuracyOverall: overall,
    accuracyRc: comfortRc,
    accuracyLn: comfortLn,
    accuracyFln: comfortFln,
    samplePlays: allPoints.length,
    rcPlays: rcPoints.length,
    lnPlays: lnPoints.length,
    flnPlays: flnPoints.length,
    coldStart: true,
  });
}

function applyBandLevels(
  base: SevenKSkillProfile,
  clear: ReturnType<typeof bandLevelsFromPlays>,
  farm: ReturnType<typeof bandLevelsFromPlays>,
  acc: ReturnType<typeof bandLevelsFromPlays>,
  topN: number,
): SevenKSkillProfile {
  const bandLevel = (band: { level: number; playCount: number }) =>
    band.playCount >= topN && band.level > 0 ? band.level : 0;

  return {
    ...base,
    peakOverall: bandLevel(clear.all),
    peakRc: bandLevel(clear.rc),
    peakLn: bandLevel(clear.ln),
    peakFln: bandLevel(clear.fln),
    clearRcMaps: clear.rc.playCount,
    clearLnMaps: clear.ln.playCount,
    clearFlnMaps: clear.fln.playCount,
    accuracyOverall: bandLevel(acc.all),
    accuracyRc: bandLevel(acc.rc),
    accuracyLn: bandLevel(acc.ln),
    accuracyFln: bandLevel(acc.fln),
    accuracyRcMaps: acc.rc.playCount,
    accuracyLnMaps: acc.ln.playCount,
    accuracyFlnMaps: acc.fln.playCount,
    consistencyOverall: bandLevel(farm.all),
    consistencyRc: bandLevel(farm.rc),
    consistencyLn: bandLevel(farm.ln),
    consistencyFln: bandLevel(farm.fln),
    consistencyRcMaps: farm.rc.playCount,
    consistencyLnMaps: farm.ln.playCount,
    consistencyFlnMaps: farm.fln.playCount,
  };
}

/**
 * Pure skill estimate from an in-memory play list.
 * Comfort and band levels use the top {@link DEFAULT_SKILL_TOP_PLAYS} Sunny-rated plays
 * (configurable via {@link topPlays}).
 */
export function estimateSevenKSkillFromPlays(
  plays: SkillPlayRow[],
  opts?: {
    asOfMs?: number;
    topPlays?: number;
    /** When true (default for history), cold-start from plays only. */
    coldStartFromPlaysOnly?: boolean;
    /** Optional DB cold-start when play-list cold-start is empty. */
    coldStartFallback?: () => SevenKSkillProfile;
  },
): SevenKSkillProfile {
  const asOfMs = opts?.asOfMs;
  const topN = normalizeTopPlays(opts?.topPlays);
  const filtered =
    asOfMs != null ? plays.filter((p) => p.playedAt <= asOfMs) : plays;

  const clear = bandLevelsFromPlays(
    filtered,
    PUSH_ACC_MIN,
    topN,
    PUSH_ACC_CENTER,
    0.025,
  );

  const farm = bandLevelsFromPlays(
    filtered,
    CONSISTENCY_ACC_MIN,
    topN,
    CONSISTENCY_ACC_CENTER,
    0.015,
  );

  const acc = bandLevelsFromPlays(
    filtered,
    ACCURACY_ACC_MIN,
    topN,
    ACCURACY_ACC_CENTER,
    0.01,
  );

  const withSunny = topRatedPlays(filtered, topN);

  if (withSunny.length < MIN_PLAYS_FOR_SKILL) {
    const fromPlays = coldStartFromPlays(filtered);
    if (fromPlays.overall > 0) {
      return applyBandLevels(fromPlays, clear, farm, acc, topN);
    }
    if (!opts?.coldStartFromPlaysOnly && opts?.coldStartFallback) {
      const fallback = opts.coldStartFallback();
      if (fallback.overall > 0) {
        return applyBandLevels(fallback, clear, farm, acc, topN);
      }
    }
    return emptySkill({
      samplePlays: withSunny.length,
      clearRcMaps: clear.rc.playCount,
      clearLnMaps: clear.ln.playCount,
      clearFlnMaps: clear.fln.playCount,
      accuracyRcMaps: acc.rc.playCount,
      accuracyLnMaps: acc.ln.playCount,
      accuracyFlnMaps: acc.fln.playCount,
      consistencyRcMaps: farm.rc.playCount,
      consistencyLnMaps: farm.ln.playCount,
      consistencyFlnMaps: farm.fln.playCount,
    });
  }

  const total = withSunny.length;
  const rcPoints: Array<{ value: number; weight: number }> = [];
  const lnPoints: Array<{ value: number; weight: number }> = [];
  const flnPoints: Array<{ value: number; weight: number }> = [];
  const allPoints: Array<{ value: number; weight: number }> = [];

  for (let i = 0; i < withSunny.length; i++) {
    const play = withSunny[i]!;
    const recencyWeight = Math.pow(RECENCY_DECAY, total - i - 1);
    const combined = recencyWeight * accuracyWeight(play.accuracy);
    const point = { value: play.sunnyStar!, weight: combined };
    allPoints.push(point);
    const axis = classifyMapAxis(play.lnRatio);
    if (axis === "fln") flnPoints.push(point);
    else if (axis === "ln") lnPoints.push(point);
    else rcPoints.push(point);
  }

  const rc = weightedMean(rcPoints);
  const ln = weightedMean(lnPoints);
  const fln = weightedMean(flnPoints);
  const overall = weightedMean(allPoints);
  const comfortRc = rc > 0 ? rc : overall;
  const comfortLn = ln > 0 ? ln : overall;
  const comfortFln = fln > 0 ? fln : overall;

  return applyBandLevels(
    emptySkill({
      overall,
      rc: comfortRc,
      ln: comfortLn,
      fln: comfortFln,
      samplePlays: withSunny.length,
      rcPlays: rcPoints.length,
      lnPlays: lnPoints.length,
      flnPlays: flnPoints.length,
      coldStart: false,
    }),
    clear,
    farm,
    acc,
    topN,
  );
}

function loadAllSevenKPlays(db: Db): SkillPlayRow[] {
  const rows = db.$client
    .query(
      `
      SELECT
        s.beatmap_id AS beatmapId,
        s.accuracy AS accuracy,
        s.played_at AS playedAt,
        dr.sunny_star AS sunnyStar,
        dr.ln_ratio AS lnRatio
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = 'sunny'
      WHERE s.delete_pending = 0
        AND b.hidden = 0
        AND COALESCE(bs.delete_pending, 0) = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = 7
        AND s.beatmap_id IS NOT NULL
      ORDER BY s.played_at DESC
    `,
    )
    .all() as Array<{
    beatmapId: string;
    accuracy: number;
    playedAt: number;
    sunnyStar: number | null;
    lnRatio: number | null;
  }>;

  return rows.map((r) => ({
    beatmapId: r.beatmapId,
    accuracy: Number(r.accuracy ?? 0),
    playedAt: Number(r.playedAt ?? 0),
    sunnyStar: r.sunnyStar != null ? Number(r.sunnyStar) : null,
    lnRatio: r.lnRatio != null ? Number(r.lnRatio) : null,
  }));
}

function ensureSunnyForPlays(db: Db, plays: SkillPlayRow[]): SkillPlayRow[] {
  const missingIds = [
    ...new Set(
      plays.filter((p) => p.sunnyStar == null).map((p) => p.beatmapId),
    ),
  ];
  if (missingIds.length === 0) return plays;
  ensureSunnyDanForIdsSync(db, missingIds);
  return loadAllSevenKPlays(db);
}

/**
 * Estimate 7K skill:
 * - comfort (overall/rc/ln/fln): recent plays, recency × acc weight
 * - peak*: average Sunny of maps with 90–95% scores (Push base)
 * - accuracy*: average Sunny of maps with 99%+ scores (Accuracy base)
 * - consistency*: average Sunny of maps with 96–99% scores (Consistency base)
 */
export function estimateSevenKSkill(
  db: Db,
  opts?: SevenKSkillOptions,
): SevenKSkillProfile {
  backfillSunnyDanSync(db, { limit: 120 });
  let plays = loadAllSevenKPlays(db);
  plays = ensureSunnyForPlays(db, plays);
  return estimateSevenKSkillFromPlays(plays, {
    topPlays: opts?.topPlays,
    coldStartFallback: () => coldStartFromMastery(db),
  });
}

function utcDayKey(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Monday of the UTC week containing `ms`, as YYYY-MM-DD. */
function utcWeekStartKey(ms: number): string {
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0 Sun … 6 Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diffToMonday);
  return utcDayKey(d.getTime());
}

function endOfUtcDayMs(dayKey: string): number {
  const [y, m, d] = dayKey.split("-").map(Number);
  return Date.UTC(y!, m! - 1, d!, 23, 59, 59, 999);
}

function endOfUtcWeekMs(weekStartKey: string): number {
  const [y, m, d] = weekStartKey.split("-").map(Number);
  // Week start Monday 00:00 → Sunday 23:59:59.999
  return Date.UTC(y!, m! - 1, d! + 6, 23, 59, 59, 999);
}

function buildSampleKeys(
  granularity: "day" | "week",
  rangeDays: number,
  nowMs: number,
): string[] {
  const keys: string[] = [];
  if (granularity === "day") {
    for (let i = rangeDays - 1; i >= 0; i--) {
      const ms = nowMs - i * 86_400_000;
      keys.push(utcDayKey(ms));
    }
    return [...new Set(keys)];
  }

  const weeks = Math.max(1, Math.ceil(rangeDays / 7));
  for (let i = weeks - 1; i >= 0; i--) {
    const ms = nowMs - i * 7 * 86_400_000;
    keys.push(utcWeekStartKey(ms));
  }
  return [...new Set(keys)];
}

/**
 * Skill evolution series: one estimate per day or week end, from a single play load.
 */
export function estimateSevenKSkillHistory(
  db: Db,
  opts: SkillHistoryOptions,
  nowMs: number = Date.now(),
): SkillHistoryPoint[] {
  backfillSunnyDanSync(db, { limit: 80 });
  let plays = loadAllSevenKPlays(db);
  plays = ensureSunnyForPlays(db, plays);

  const keys = buildSampleKeys(opts.granularity, opts.rangeDays, nowMs);
  const points: SkillHistoryPoint[] = [];

  for (const key of keys) {
    const asOfMs =
      opts.granularity === "day" ? endOfUtcDayMs(key) : endOfUtcWeekMs(key);
    const skill = estimateSevenKSkillFromPlays(plays, {
      asOfMs,
      topPlays: opts.topPlays,
      coldStartFromPlaysOnly: true,
    });
    points.push({
      at: key,
      push: skill.peakOverall,
      accuracy: skill.accuracyOverall,
      consistency: skill.consistencyOverall,
      pushRc: skill.peakRc,
      pushLn: skill.peakLn,
      pushFln: skill.peakFln,
      accuracyRc: skill.accuracyRc,
      accuracyLn: skill.accuracyLn,
      accuracyFln: skill.accuracyFln,
      consistencyRc: skill.consistencyRc,
      consistencyLn: skill.consistencyLn,
      consistencyFln: skill.consistencyFln,
      overall: skill.overall,
      rc: skill.rc,
      ln: skill.ln,
      fln: skill.fln,
      coldStart: skill.coldStart,
    });
  }

  return points;
}

/** Exposed for unit tests. */
export const __testing = {
  aggregateAccBandMaps,
  buildSampleKeys,
  endOfUtcDayMs,
  endOfUtcWeekMs,
  utcDayKey,
  utcWeekStartKey,
  topPlaysInBand,
  topRatedPlays,
  bestPlayPerMap,
  PUSH_ACC_MIN,
  PUSH_ACC_MAX,
  CONSISTENCY_ACC_MIN,
  CONSISTENCY_ACC_MAX,
  ACCURACY_ACC_MIN,
  ACCURACY_ACC_MAX,
};

export type SkillMode = "comfort" | "peak" | "consistency" | "accuracy";

export function skillForAxis(
  skill: SevenKSkillProfile,
  axis: SkillAxis | null | undefined,
  mode: SkillMode = "comfort",
): number {
  if (mode === "peak") {
    if (!axis || axis === "overall") return skill.peakOverall;
    if (axis === "rc") return skill.peakRc;
    if (axis === "fln") return skill.peakFln;
    return skill.peakLn;
  }
  if (mode === "accuracy") {
    if (!axis || axis === "overall") return skill.accuracyOverall;
    if (axis === "rc") return skill.accuracyRc;
    if (axis === "fln") return skill.accuracyFln;
    return skill.accuracyLn;
  }
  if (mode === "consistency") {
    if (!axis || axis === "overall") return skill.consistencyOverall;
    if (axis === "rc") return skill.consistencyRc;
    if (axis === "fln") return skill.consistencyFln;
    return skill.consistencyLn;
  }
  if (!axis || axis === "overall") return skill.overall;
  if (axis === "rc") return skill.rc > 0 ? skill.rc : skill.overall;
  if (axis === "fln") return skill.fln > 0 ? skill.fln : skill.overall;
  return skill.ln > 0 ? skill.ln : skill.overall;
}

/** Weaker of RC/LN/FLN comfort skills (ties prefer fewer sample plays). */
export function weakestAxis(skill: SevenKSkillProfile): MapAxis {
  const candidates: Array<{ axis: MapAxis; value: number; plays: number }> = (
    [
      {
        axis: "rc" as const,
        value: skill.rc > 0 ? skill.rc : skill.overall,
        plays: skill.rcPlays,
      },
      {
        axis: "ln" as const,
        value: skill.ln > 0 ? skill.ln : skill.overall,
        plays: skill.lnPlays,
      },
      {
        axis: "fln" as const,
        value: skill.fln > 0 ? skill.fln : skill.overall,
        plays: skill.flnPlays,
      },
    ] satisfies Array<{ axis: MapAxis; value: number; plays: number }>
  ).filter((c) => c.value > 0);

  if (candidates.length === 0) return "rc";

  candidates.sort((a, b) => {
    if (Math.abs(a.value - b.value) < 0.05) return a.plays - b.plays;
    return a.value - b.value;
  });
  return candidates[0]!.axis;
}

/** Strongest comfort axis (for skillset default). */
export function strongestAxis(skill: SevenKSkillProfile): MapAxis {
  const candidates: Array<{ axis: MapAxis; value: number }> = [
    { axis: "rc", value: skill.rc > 0 ? skill.rc : 0 },
    { axis: "ln", value: skill.ln > 0 ? skill.ln : 0 },
    { axis: "fln", value: skill.fln > 0 ? skill.fln : 0 },
  ];
  candidates.sort((a, b) => b.value - a.value);
  return candidates[0]!.value > 0 ? candidates[0]!.axis : "rc";
}
