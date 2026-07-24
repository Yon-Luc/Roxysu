import type { Db } from "@roxysu/db/client.bun";
import {
  backfillSunnyDanSync,
  ensureSunnyDanForIdsSync,
} from "../../map-analysis/computeSunnyDan";
import { classifyMapAxis } from "./axis";
import type { MapAxis, SevenKSkillProfile, SkillAxis } from "./types";

/** Min plays before we trust the comfort estimate (else cold-start). */
const MIN_PLAYS_FOR_SKILL = 5;

/** Cap how many recent 7K scores we scan for comfort skill. */
const MAX_SKILL_PLAYS = 500;

/** Min distinct maps in an accuracy band before that level is trusted. */
const MIN_CLEAR_MAPS = 3;

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
};

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

/**
 * Maps with at least one score in [accMin, accMax) — dan-style level for that band.
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
 * Average Sunny of maps in an accuracy band on an axis.
 * Weight: band play count × closeness to band center × mild recency.
 */
function clearLevelFromMaps(
  maps: ClearMapRow[],
  axis: MapAxis | "all",
  accCenter: number,
  halfWidth: number,
): { level: number; mapCount: number } {
  const filtered =
    axis === "all"
      ? maps
      : maps.filter((m) => classifyMapAxis(m.lnRatio) === axis);

  if (filtered.length === 0) return { level: 0, mapCount: 0 };

  const newest = Math.max(...filtered.map((m) => m.lastPlayedAt));
  const oldest = Math.min(...filtered.map((m) => m.lastPlayedAt));
  const span = Math.max(newest - oldest, 1);

  const points: Array<{ value: number; weight: number }> = [];
  for (const map of filtered) {
    if (!(map.sunnyStar > 0)) continue;
    const accDist = Math.abs(map.avgBandAcc - accCenter);
    const accProximity = Math.max(0.35, 1 - accDist / Math.max(halfWidth, 0.01));
    const recency = 0.5 + 0.5 * ((map.lastPlayedAt - oldest) / span);
    const weight = Math.max(1, map.bandPlays) * accProximity * recency;
    points.push({ value: map.sunnyStar, weight });
  }

  return {
    level: weightedMean(points),
    mapCount: filtered.length,
  };
}

function bandLevels(
  maps: ClearMapRow[],
  center: number,
  halfWidth: number,
) {
  return {
    all: clearLevelFromMaps(maps, "all", center, halfWidth),
    rc: clearLevelFromMaps(maps, "rc", center, halfWidth),
    ln: clearLevelFromMaps(maps, "ln", center, halfWidth),
    fln: clearLevelFromMaps(maps, "fln", center, halfWidth),
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
  comfort: { rc: number; ln: number; fln: number; overall: number },
  clear: ReturnType<typeof bandLevels>,
  farm: ReturnType<typeof bandLevels>,
  acc: ReturnType<typeof bandLevels>,
): SevenKSkillProfile {
  const bandOrFallback = (
    band: { level: number; mapCount: number },
    fallback: number,
  ) =>
    band.mapCount >= MIN_CLEAR_MAPS && band.level > 0 ? band.level : fallback;

  return {
    ...base,
    peakOverall: bandOrFallback(clear.all, comfort.overall),
    peakRc: bandOrFallback(clear.rc, comfort.rc),
    peakLn: bandOrFallback(clear.ln, comfort.ln),
    peakFln: bandOrFallback(clear.fln, comfort.fln),
    clearRcMaps: clear.rc.mapCount,
    clearLnMaps: clear.ln.mapCount,
    clearFlnMaps: clear.fln.mapCount,
    accuracyOverall: bandOrFallback(acc.all, comfort.overall),
    accuracyRc: bandOrFallback(acc.rc, comfort.rc),
    accuracyLn: bandOrFallback(acc.ln, comfort.ln),
    accuracyFln: bandOrFallback(acc.fln, comfort.fln),
    accuracyRcMaps: acc.rc.mapCount,
    accuracyLnMaps: acc.ln.mapCount,
    accuracyFlnMaps: acc.fln.mapCount,
    consistencyOverall: bandOrFallback(farm.all, comfort.overall),
    consistencyRc: bandOrFallback(farm.rc, comfort.rc),
    consistencyLn: bandOrFallback(farm.ln, comfort.ln),
    consistencyFln: bandOrFallback(farm.fln, comfort.fln),
    consistencyRcMaps: farm.rc.mapCount,
    consistencyLnMaps: farm.ln.mapCount,
    consistencyFlnMaps: farm.fln.mapCount,
  };
}

/**
 * Pure skill estimate from an in-memory play list.
 * Comfort uses the most recent {@link MAX_SKILL_PLAYS} plays with Sunny;
 * push / accuracy / consistency bands use the full list.
 */
export function estimateSevenKSkillFromPlays(
  plays: SkillPlayRow[],
  opts?: {
    asOfMs?: number;
    /** When true (default for history), cold-start from plays only. */
    coldStartFromPlaysOnly?: boolean;
    /** Optional DB cold-start when play-list cold-start is empty. */
    coldStartFallback?: () => SevenKSkillProfile;
  },
): SevenKSkillProfile {
  const asOfMs = opts?.asOfMs;
  const filtered =
    asOfMs != null ? plays.filter((p) => p.playedAt <= asOfMs) : plays;

  const pushMaps = aggregateAccBandMaps(filtered, PUSH_ACC_MIN, PUSH_ACC_MAX);
  const clear = bandLevels(pushMaps, PUSH_ACC_CENTER, 0.025);

  const farmMaps = aggregateAccBandMaps(
    filtered,
    CONSISTENCY_ACC_MIN,
    CONSISTENCY_ACC_MAX,
  );
  const farm = bandLevels(farmMaps, CONSISTENCY_ACC_CENTER, 0.015);

  const accMaps = aggregateAccBandMaps(
    filtered,
    ACCURACY_ACC_MIN,
    ACCURACY_ACC_MAX,
  );
  const acc = bandLevels(accMaps, ACCURACY_ACC_CENTER, 0.01);

  const recent = filtered
    .slice()
    .sort((a, b) => b.playedAt - a.playedAt)
    .slice(0, MAX_SKILL_PLAYS);

  const withSunny = recent
    .filter(
      (p): p is SkillPlayRow & { sunnyStar: number } =>
        p.sunnyStar != null && p.sunnyStar > 0,
    )
    .slice()
    .reverse();

  if (withSunny.length < MIN_PLAYS_FOR_SKILL) {
    const fromPlays = coldStartFromPlays(filtered);
    if (fromPlays.overall > 0) {
      return applyBandLevels(
        fromPlays,
        {
          overall: fromPlays.overall,
          rc: fromPlays.rc,
          ln: fromPlays.ln,
          fln: fromPlays.fln,
        },
        clear,
        farm,
        acc,
      );
    }
    if (!opts?.coldStartFromPlaysOnly && opts?.coldStartFallback) {
      const fallback = opts.coldStartFallback();
      if (fallback.overall > 0) {
        return applyBandLevels(
          fallback,
          {
            overall: fallback.overall,
            rc: fallback.rc,
            ln: fallback.ln,
            fln: fallback.fln,
          },
          clear,
          farm,
          acc,
        );
      }
    }
    return emptySkill({
      samplePlays: withSunny.length,
      clearRcMaps: clear.rc.mapCount,
      clearLnMaps: clear.ln.mapCount,
      clearFlnMaps: clear.fln.mapCount,
      accuracyRcMaps: acc.rc.mapCount,
      accuracyLnMaps: acc.ln.mapCount,
      accuracyFlnMaps: acc.fln.mapCount,
      consistencyRcMaps: farm.rc.mapCount,
      consistencyLnMaps: farm.ln.mapCount,
      consistencyFlnMaps: farm.fln.mapCount,
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
    const point = { value: play.sunnyStar, weight: combined };
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
    {
      overall,
      rc: comfortRc,
      ln: comfortLn,
      fln: comfortFln,
    },
    clear,
    farm,
    acc,
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
export function estimateSevenKSkill(db: Db): SevenKSkillProfile {
  backfillSunnyDanSync(db, { limit: 120 });
  let plays = loadAllSevenKPlays(db);
  plays = ensureSunnyForPlays(db, plays);
  return estimateSevenKSkillFromPlays(plays, {
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
      coldStartFromPlaysOnly: true,
    });
    points.push({
      at: key,
      push: skill.peakOverall,
      accuracy: skill.accuracyOverall,
      consistency: skill.consistencyOverall,
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
  PUSH_ACC_MIN,
  PUSH_ACC_MAX,
  CONSISTENCY_ACC_MIN,
  CONSISTENCY_ACC_MAX,
  ACCURACY_ACC_MIN,
  ACCURACY_ACC_MAX,
  MIN_CLEAR_MAPS,
};

export type SkillMode = "comfort" | "peak" | "consistency" | "accuracy";

export function skillForAxis(
  skill: SevenKSkillProfile,
  axis: SkillAxis | null | undefined,
  mode: SkillMode = "comfort",
): number {
  if (mode === "peak") {
    if (!axis || axis === "overall") return skill.peakOverall;
    if (axis === "rc") {
      return skill.peakRc > 0 ? skill.peakRc : skill.peakOverall;
    }
    if (axis === "fln") {
      return skill.peakFln > 0 ? skill.peakFln : skill.peakOverall;
    }
    return skill.peakLn > 0 ? skill.peakLn : skill.peakOverall;
  }
  if (mode === "accuracy") {
    if (!axis || axis === "overall") return skill.accuracyOverall;
    if (axis === "rc") {
      return skill.accuracyRc > 0
        ? skill.accuracyRc
        : skill.accuracyOverall;
    }
    if (axis === "fln") {
      return skill.accuracyFln > 0
        ? skill.accuracyFln
        : skill.accuracyOverall;
    }
    return skill.accuracyLn > 0
      ? skill.accuracyLn
      : skill.accuracyOverall;
  }
  if (mode === "consistency") {
    if (!axis || axis === "overall") return skill.consistencyOverall;
    if (axis === "rc") {
      return skill.consistencyRc > 0
        ? skill.consistencyRc
        : skill.consistencyOverall;
    }
    if (axis === "fln") {
      return skill.consistencyFln > 0
        ? skill.consistencyFln
        : skill.consistencyOverall;
    }
    return skill.consistencyLn > 0
      ? skill.consistencyLn
      : skill.consistencyOverall;
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
