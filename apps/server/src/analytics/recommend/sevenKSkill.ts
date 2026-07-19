import type { Db } from "@roxysu/db/client.bun";
import { LN_DAN_RATIO_THRESHOLD } from "../../map-analysis/estDiff";
import {
  backfillSunnyDanSync,
  ensureSunnyDanForIdsSync,
} from "../../map-analysis/computeSunnyDan";
import type { SevenKSkillProfile, SkillAxis } from "./types";

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

/** Recency decay per play index (Companella uses 0.95). */
const RECENCY_DECAY = 0.95;

type SkillPlayRow = {
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

function classifyAxis(lnRatio: number | null): "rc" | "ln" {
  return (lnRatio ?? 0) >= LN_DAN_RATIO_THRESHOLD ? "ln" : "rc";
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
    peakOverall: 0,
    peakRc: 0,
    peakLn: 0,
    clearRcMaps: 0,
    clearLnMaps: 0,
    consistencyOverall: 0,
    consistencyRc: 0,
    consistencyLn: 0,
    consistencyRcMaps: 0,
    consistencyLnMaps: 0,
    samplePlays: 0,
    rcPlays: 0,
    lnPlays: 0,
    coldStart: true,
    ...partial,
  };
}

function loadRecentSevenKPlays(db: Db): SkillPlayRow[] {
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
      LIMIT ?
    `,
    )
    .all(MAX_SKILL_PLAYS) as Array<{
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

/**
 * Maps with at least one score in [accMin, accMax) — dan-style level for that band.
 */
function loadAccBandMaps(
  db: Db,
  accMin: number,
  accMax: number,
): ClearMapRow[] {
  const rows = db.$client
    .query(
      `
      SELECT
        b.id AS beatmapId,
        dr.sunny_star AS sunnyStar,
        dr.ln_ratio AS lnRatio,
        COUNT(*) AS bandPlays,
        AVG(s.accuracy) AS avgBandAcc,
        MAX(s.played_at) AS lastPlayedAt
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = 'sunny'
      WHERE s.delete_pending = 0
        AND b.hidden = 0
        AND COALESCE(bs.delete_pending, 0) = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = 7
        AND dr.sunny_star IS NOT NULL
        AND s.accuracy >= ?
        AND s.accuracy < ?
      GROUP BY b.id
    `,
    )
    .all(accMin, accMax) as Array<{
    beatmapId: string;
    sunnyStar: number;
    lnRatio: number | null;
    bandPlays: number;
    avgBandAcc: number;
    lastPlayedAt: number;
  }>;

  return rows.map((r) => ({
    beatmapId: r.beatmapId,
    sunnyStar: Number(r.sunnyStar),
    lnRatio: r.lnRatio != null ? Number(r.lnRatio) : null,
    bandPlays: Number(r.bandPlays ?? 0),
    avgBandAcc: Number(r.avgBandAcc ?? 0),
    lastPlayedAt: Number(r.lastPlayedAt ?? 0),
  }));
}

/**
 * Average Sunny of maps in an accuracy band on an axis.
 * Weight: band play count × closeness to band center × mild recency.
 */
function clearLevelFromMaps(
  maps: ClearMapRow[],
  axis: "rc" | "ln" | "all",
  accCenter: number,
  halfWidth: number,
): { level: number; mapCount: number } {
  const filtered =
    axis === "all"
      ? maps
      : maps.filter((m) => classifyAxis(m.lnRatio) === axis);

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
  const allPoints: Array<{ value: number; weight: number }> = [];

  for (const row of rows) {
    const sunny = Number(row.sunnyStar);
    if (!Number.isFinite(sunny) || sunny <= 0) continue;
    const acc = Number(row.bestAccuracy ?? 0);
    const weight = Math.max(0.05, accuracyWeight(acc));
    const point = { value: sunny, weight };
    allPoints.push(point);
    if (classifyAxis(row.lnRatio != null ? Number(row.lnRatio) : null) === "ln") {
      lnPoints.push(point);
    } else {
      rcPoints.push(point);
    }
  }

  const rc = weightedMean(rcPoints);
  const ln = weightedMean(lnPoints);
  const overall = allPoints.length > 0 ? weightedMean(allPoints) : 0;
  return emptySkill({
    overall,
    rc: rc > 0 ? rc : overall,
    ln: ln > 0 ? ln : overall,
    peakOverall: overall,
    peakRc: rc > 0 ? rc : overall,
    peakLn: ln > 0 ? ln : overall,
    samplePlays: allPoints.length,
    rcPlays: rcPoints.length,
    lnPlays: lnPoints.length,
    coldStart: true,
  });
}

/**
 * Estimate 7K skill:
 * - comfort (overall/rc/ln): recent plays, recency × acc weight (Deficit / Skillset)
 * - peak*: average Sunny of maps with 90–95% scores (Push base)
 * - consistency*: average Sunny of maps with 96–99% scores (Consistency base)
 */
export function estimateSevenKSkill(db: Db): SevenKSkillProfile {
  backfillSunnyDanSync(db, { limit: 120 });

  let plays = loadRecentSevenKPlays(db);
  const missingIds = [
    ...new Set(
      plays.filter((p) => p.sunnyStar == null).map((p) => p.beatmapId),
    ),
  ];
  if (missingIds.length > 0) {
    ensureSunnyDanForIdsSync(db, missingIds);
    plays = loadRecentSevenKPlays(db);
  }

  const pushMaps = loadAccBandMaps(db, PUSH_ACC_MIN, PUSH_ACC_MAX);
  const clearRc = clearLevelFromMaps(pushMaps, "rc", PUSH_ACC_CENTER, 0.025);
  const clearLn = clearLevelFromMaps(pushMaps, "ln", PUSH_ACC_CENTER, 0.025);
  const clearAll = clearLevelFromMaps(pushMaps, "all", PUSH_ACC_CENTER, 0.025);

  const farmMaps = loadAccBandMaps(
    db,
    CONSISTENCY_ACC_MIN,
    CONSISTENCY_ACC_MAX,
  );
  const farmRc = clearLevelFromMaps(
    farmMaps,
    "rc",
    CONSISTENCY_ACC_CENTER,
    0.015,
  );
  const farmLn = clearLevelFromMaps(
    farmMaps,
    "ln",
    CONSISTENCY_ACC_CENTER,
    0.015,
  );
  const farmAll = clearLevelFromMaps(
    farmMaps,
    "all",
    CONSISTENCY_ACC_CENTER,
    0.015,
  );

  const withSunny = plays
    .filter(
      (p): p is SkillPlayRow & { sunnyStar: number } =>
        p.sunnyStar != null && p.sunnyStar > 0,
    )
    .slice()
    .reverse();

  const bandOrFallback = (
    band: { level: number; mapCount: number },
    fallback: number,
  ) =>
    band.mapCount >= MIN_CLEAR_MAPS && band.level > 0 ? band.level : fallback;

  if (withSunny.length < MIN_PLAYS_FOR_SKILL) {
    const fallback = coldStartFromMastery(db);
    if (fallback.overall > 0) {
      return {
        ...fallback,
        peakOverall: bandOrFallback(clearAll, fallback.overall),
        peakRc: bandOrFallback(clearRc, fallback.rc),
        peakLn: bandOrFallback(clearLn, fallback.ln),
        clearRcMaps: clearRc.mapCount,
        clearLnMaps: clearLn.mapCount,
        consistencyOverall: bandOrFallback(farmAll, fallback.overall),
        consistencyRc: bandOrFallback(farmRc, fallback.rc),
        consistencyLn: bandOrFallback(farmLn, fallback.ln),
        consistencyRcMaps: farmRc.mapCount,
        consistencyLnMaps: farmLn.mapCount,
      };
    }
    return emptySkill({
      samplePlays: withSunny.length,
      clearRcMaps: clearRc.mapCount,
      clearLnMaps: clearLn.mapCount,
      consistencyRcMaps: farmRc.mapCount,
      consistencyLnMaps: farmLn.mapCount,
    });
  }

  const total = withSunny.length;
  const rcPoints: Array<{ value: number; weight: number }> = [];
  const lnPoints: Array<{ value: number; weight: number }> = [];
  const allPoints: Array<{ value: number; weight: number }> = [];

  for (let i = 0; i < withSunny.length; i++) {
    const play = withSunny[i]!;
    const recencyWeight = Math.pow(RECENCY_DECAY, total - i - 1);
    const combined = recencyWeight * accuracyWeight(play.accuracy);
    const point = { value: play.sunnyStar, weight: combined };
    allPoints.push(point);
    if (classifyAxis(play.lnRatio) === "ln") lnPoints.push(point);
    else rcPoints.push(point);
  }

  const rc = weightedMean(rcPoints);
  const ln = weightedMean(lnPoints);
  const overall = weightedMean(allPoints);
  const comfortRc = rc > 0 ? rc : overall;
  const comfortLn = ln > 0 ? ln : overall;

  return {
    overall,
    rc: comfortRc,
    ln: comfortLn,
    peakOverall: bandOrFallback(clearAll, overall),
    peakRc: bandOrFallback(clearRc, comfortRc),
    peakLn: bandOrFallback(clearLn, comfortLn),
    clearRcMaps: clearRc.mapCount,
    clearLnMaps: clearLn.mapCount,
    consistencyOverall: bandOrFallback(farmAll, overall),
    consistencyRc: bandOrFallback(farmRc, comfortRc),
    consistencyLn: bandOrFallback(farmLn, comfortLn),
    consistencyRcMaps: farmRc.mapCount,
    consistencyLnMaps: farmLn.mapCount,
    samplePlays: withSunny.length,
    rcPlays: rcPoints.length,
    lnPlays: lnPoints.length,
    coldStart: false,
  };
}

export function skillForAxis(
  skill: SevenKSkillProfile,
  axis: SkillAxis | null | undefined,
  mode: "comfort" | "peak" | "consistency" = "comfort",
): number {
  if (mode === "peak") {
    if (!axis || axis === "overall") return skill.peakOverall;
    if (axis === "rc") {
      return skill.peakRc > 0 ? skill.peakRc : skill.peakOverall;
    }
    return skill.peakLn > 0 ? skill.peakLn : skill.peakOverall;
  }
  if (mode === "consistency") {
    if (!axis || axis === "overall") return skill.consistencyOverall;
    if (axis === "rc") {
      return skill.consistencyRc > 0
        ? skill.consistencyRc
        : skill.consistencyOverall;
    }
    return skill.consistencyLn > 0
      ? skill.consistencyLn
      : skill.consistencyOverall;
  }
  if (!axis || axis === "overall") return skill.overall;
  if (axis === "rc") return skill.rc > 0 ? skill.rc : skill.overall;
  return skill.ln > 0 ? skill.ln : skill.overall;
}

/** Weaker of RC/LN comfort skills (ties prefer fewer sample plays). */
export function weakestAxis(skill: SevenKSkillProfile): "rc" | "ln" {
  const rc = skill.rc > 0 ? skill.rc : skill.overall;
  const ln = skill.ln > 0 ? skill.ln : skill.overall;
  if (rc <= 0 && ln <= 0) return "rc";
  if (rc <= 0) return "ln";
  if (ln <= 0) return "rc";
  if (Math.abs(rc - ln) < 0.05) {
    return skill.rcPlays <= skill.lnPlays ? "rc" : "ln";
  }
  return rc < ln ? "rc" : "ln";
}
