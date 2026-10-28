

import type { Db } from "@roxysu/db/types";
import { beatmaps } from "@roxysu/db/schema";
import { and, count, eq, sql } from "drizzle-orm";
import { REWORK_ALGORITHM } from "../map-analysis/reworkEstimator";
import { PATTERN_ALGORITHM } from "../map-analysis/computePatternAnalysis";
import {
  danVariantKey,
  resolveDanVariant,
} from "../replay/mods";
import { loadDanVariantRatingsSync } from "../map-analysis/computeDanVariants";
import { classifyMapAxis } from "./recommend/axis";
import {
  DEFAULT_AXIS_THRESHOLDS,
  readAxisThresholdsSync,
  type AxisThresholds,
} from "./recommend/axisThresholds";
import {
  bandCenter,
  bandHalfWidth,
  readFocusSettingsSync,
  type RecommendFocusSettings,
} from "./recommend/focusSettings";
import { classifyScoreGrade, PERFECT_TOTAL_SCORE } from "../query-language/scoreGrade";
import {
  DEFAULT_SKILL_KEY_COUNT,
  bandLevelsFromPlays,
  estimateSevenKSkillWithHistoryFromPlays,
  parseSkillKeyCount,
  parseSkillTopPlays,
  skillBandAccRange,
  type SkillBandKind,
  type SkillPlayRow,
} from "./recommend/sevenKSkill";
import {
  loadManiaPpCurvesSync,
  resolveScorePp,
  type ManiaPpCurve,
} from "../mania-rating/estimateScorePp";
import {
  resolveScoresGamemodeSync,
  scoresGamemodeSql,
} from "./scoreGamemode";
import {
  resolveScoresUsernamesSync,
  scoresUsernameSql,
} from "./scoreUsername";
import {
  dominantMapperUsername,
  mapperGroupKey,
  mapperOnlineIdFromGroupKey,
} from "./mapperUsername";

type ScoreScope = { sql: string; params: string[] };

/** Username + gamemode SQL fragments for score-scoped analytics queries. */
function scoreScopeFilter(
  db: Db,
  opts?: { userColumn?: string; modeColumn?: string },
): ScoreScope {
  const user = scoresUsernameSql(
    resolveScoresUsernamesSync(db),
    opts?.userColumn ?? "s.user_username",
  );
  const mode = scoresGamemodeSql(
    resolveScoresGamemodeSync(db),
    opts?.modeColumn ?? "s.ruleset_short_name",
  );
  return {
    sql: `${user.sql}${mode.sql}`,
    params: [...user.params, ...mode.params],
  };
}

/** Display buckets for the rank chart (silver grades folded into gold). Fails omitted. */
const RANK_BUCKETS = [
  { key: "D", ranks: [0] },
  { key: "C", ranks: [1] },
  { key: "B", ranks: [2] },
  { key: "A", ranks: [3] },
  { key: "S", ranks: [4, 5] }, // S + SH
  { key: "SS", ranks: [6, 7] }, // SS (X/XH) — Perfect/Marvelous only, not 1M
  { key: "X", ranks: [] }, // 1,000,000 — all Marvelous
] as const;

export type StatsGranularity = "day" | "week";

export type PlayerStatsQuery = {
  granularity?: StatsGranularity;
  skillTopPlays?: number;
  /** Single mania keymode — never mixed (default 7). */
  keyCount?: number;
};

function parseGranularity(raw: unknown): StatsGranularity {
  return raw === "week" ? "week" : "day";
}

function toMs(value: Date | number | null | undefined): number | null {
  if (value == null) return null;
  return value instanceof Date ? value.getTime() : Number(value);
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function weekStartKey(d: Date): string {
  const copy = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy.toISOString().slice(0, 10);
}

function listPlayedKeyCounts(db: Db, user: ScoreScope): number[] {
  const rows = db.$client
    .query(
      `
      SELECT DISTINCT CAST(b.circle_size AS INTEGER) AS keyCount
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      WHERE s.delete_pending = 0
        ${user.sql}
        AND b.hidden = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size IS NOT NULL
      ORDER BY keyCount ASC
    `,
    )
    .all(...user.params) as Array<{ keyCount: number }>;

  const keys = rows
    .map((r) => Math.round(Number(r.keyCount)))
    .filter((n) => Number.isFinite(n) && n >= 1 && n <= 18);
  // Always offer 4K/7K even with no plays yet.
  for (const preset of [4, 7]) {
    if (!keys.includes(preset)) keys.push(preset);
  }
  return [...new Set(keys)].sort((a, b) => a - b);
}

/**
 * Compact per-play input for skill history and skillset mix: non-hidden plays
 * of mapped beatmaps, with the base rework rating joined. Everything else a play
 * contributes (summary, rank mix, play-time, progression, mapper ranks) is
 * folded into running aggregates while the rows stream, so the full row set is
 * never held in memory.
 */
type PlayCandidate = {
  beatmapId: string;
  mods: string | null;
  accuracy: number;
  playedAt: number;
  reworkStar: number | null;
  lnRatio: number | null;
  /** Primary chart shape (`mania-skill-v1`), or null/"" when unclassified. */
  shape: string | null;
  /** Mapper group key this play belongs to, or null when unattributable. */
  mapperKey: string | null;
};

type StreamedManiaRow = {
  beatmapId: string | null;
  playedAt: number;
  mods: string | null;
  accuracy: number;
  pp: number | null;
  totalScore: number;
  rank: number;
  rulesetShortName: string | null;
  lnRatio: number | null;
  reworkStar: number | null;
  shape: string | null;
  mapperOnlineId: number | null;
  mapperUsername: string | null;
  sessionId: number | null;
  hidden: number;
};

type ProgressionBucket = {
  playCount: number;
  totalPp: number;
  /** Sum of accuracy over completed plays only (no grade = failed/quit). */
  accSum: number;
  /** Completed plays counted for accuracy averages. */
  accCount: number;
};

/**
 * Per-mapper aggregate folded while plays stream. Volume counters include
 * every scoped play (hidden maps too); rated columns are folded later from
 * non-hidden candidates with a resolvable dan rating.
 */
type MapperViewAgg = {
  playCount: number;
  accSum: number;
  accCount: number;
  beatmapIds: Set<string>;
  sessionIds: Set<number>;
  usernameCounts: Map<string, number>;
  /** Distinct rated-map entries keyed `"${beatmapId}|${variantKeyOrNm}"`. */
  rated: Map<string, { star: number; lnRatio: number }>;
};

function createMapperViewAgg(): MapperViewAgg {
  return {
    playCount: 0,
    accSum: 0,
    accCount: 0,
    beatmapIds: new Set(),
    sessionIds: new Set(),
    usernameCounts: new Map(),
    rated: new Map(),
  };
}

/** One top mappers table row. */
export type TopMapperStat = {
  mapperOnlineId: number;
  mapperUsername: string | null;
  /** Plays on this mapper's maps; retries included. */
  playCount: number;
  /** Distinct beatmaps those plays are on. */
  mapsPlayed: number;
  /** Mean accuracy across those plays, or null. */
  avgAccuracy: number | null;
  /** Sessions that contain at least one of those plays. */
  sessionCount: number;
  /** Distinct rated maps per axis (user axis thresholds). */
  rcMaps: number;
  lnMaps: number;
  flnMaps: number;
  /** Rated entries backing the axis split / star mean. */
  ratedMaps: number;
  /** Mean Rework star over the rated entries, or null when none rated. */
  avgStar: number | null;
};

type ManiaPass = {
  summary: {
    scoreCount: number;
    distinctMapsPlayed: number;
    firstPlayedAt: number | null;
    lastPlayedAt: number | null;
  };
  rankByLabel: Map<string, number>;
  byHour: number[];
  byDayOfWeek: number[];
  daily: Map<string, ProgressionBucket>;
  weekly: Map<string, ProgressionBucket>;
  byMapper: Map<string, MapperViewAgg>;
  candidates: PlayCandidate[];
};

type StatementWithIterate = {
  iterate(...params: unknown[]): IterableIterator<unknown>;
};

/**
 * Stream every scoped play of one keymode once and fold it into `ManiaPass`.
 * Row order is unchanged, so order-dependent results (mapper ties, skill
 * history) match the former load-then-loop implementation.
 */
function streamManiaPass(
  db: Db,
  user: ScoreScope,
  keyCount: number,
  curves: Map<string, ManiaPpCurve>,
): ManiaPass {
  const stmt = db.$client.query(
    `
      SELECT
        s.beatmap_id AS beatmapId,
        s.played_at AS playedAt,
        s.mods AS mods,
        s.accuracy AS accuracy,
        s.pp AS pp,
        s.total_score AS totalScore,
        s.rank AS rank,
        s.ruleset_short_name AS rulesetShortName,
        dr.ln_ratio AS lnRatio,
        dr.sunny_star AS reworkStar,
        pa.shape_pattern AS shape,
        b.mapper_online_id AS mapperOnlineId,
        b.mapper_username AS mapperUsername,
        sm.session_id AS sessionId,
        b.hidden AS hidden
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      LEFT JOIN beatmap_pattern_analysis pa
        ON pa.beatmap_id = b.id AND pa.algorithm = ?
      LEFT JOIN score_metrics sm ON sm.score_id = s.id
      WHERE s.delete_pending = 0
        ${user.sql}
        AND COALESCE(bs.delete_pending, 0) = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = ?
    `,
  ) as unknown as StatementWithIterate;

  const maps = new Set<string>();
  const pass: ManiaPass = {
    summary: {
      scoreCount: 0,
      distinctMapsPlayed: 0,
      firstPlayedAt: null,
      lastPlayedAt: null,
    },
    rankByLabel: new Map(),
    byHour: Array.from({ length: 24 }, () => 0),
    byDayOfWeek: Array.from({ length: 7 }, () => 0), // 0 = Sunday UTC
    daily: new Map(),
    weekly: new Map(),
    byMapper: new Map(),
    candidates: [],
  };

  for (const raw of stmt.iterate(
    REWORK_ALGORITHM,
    PATTERN_ALGORITHM,
    ...user.params,
    keyCount,
  )) {
    const row = raw as StreamedManiaRow;
    pass.summary.scoreCount += 1;
    if (row.beatmapId) maps.add(row.beatmapId);

    // No grade = failed / quit play: counts as activity, but its accuracy
    // must not pollute accuracy averages.
    const graded = row.rank !== -1;
    if (graded) {
      const label = classifyScoreGrade(Number(row.totalScore), row.rank);
      if (label) {
        pass.rankByLabel.set(label, (pass.rankByLabel.get(label) ?? 0) + 1);
      }
    }

    const accuracy = Number(row.accuracy ?? 0);
    const pp =
      resolveScorePp({
        pp: row.pp,
        accuracy: row.accuracy,
        mods: row.mods,
        rulesetShortName: row.rulesetShortName,
        curve: row.beatmapId ? curves.get(row.beatmapId) : undefined,
      }) ?? 0;

    const ms = Number(row.playedAt ?? 0);
    if (Number.isFinite(ms) && ms > 0) {
      const { summary } = pass;
      if (summary.firstPlayedAt == null || ms < summary.firstPlayedAt) {
        summary.firstPlayedAt = ms;
      }
      if (summary.lastPlayedAt == null || ms > summary.lastPlayedAt) {
        summary.lastPlayedAt = ms;
      }
      const played = new Date(ms);
      pass.byHour[played.getUTCHours()]! += 1;
      pass.byDayOfWeek[played.getUTCDay()]! += 1;
      bumpBucket(pass.daily, dayKey(played), pp, accuracy, graded);
      bumpBucket(pass.weekly, weekStartKey(played), pp, accuracy, graded);
    }

    const mapperKey = mapperGroupKey(row.mapperOnlineId, row.mapperUsername);
    if (mapperKey) {
      const cur = pass.byMapper.get(mapperKey) ?? createMapperViewAgg();
      cur.playCount += 1;
      if (graded) {
        cur.accSum += accuracy;
        cur.accCount += 1;
      }
      if (row.beatmapId) cur.beatmapIds.add(row.beatmapId);
      if (row.sessionId != null) cur.sessionIds.add(Number(row.sessionId));
      const name = row.mapperUsername?.trim();
      if (name) {
        cur.usernameCounts.set(name, (cur.usernameCounts.get(name) ?? 0) + 1);
      }
      pass.byMapper.set(mapperKey, cur);
    }

    if (!row.hidden && row.beatmapId != null) {
      pass.candidates.push({
        beatmapId: row.beatmapId,
        mods: row.mods,
        accuracy,
        playedAt: Number(row.playedAt ?? 0),
        reworkStar: row.reworkStar,
        lnRatio: row.lnRatio,
        shape: row.shape ?? null,
        mapperKey,
      });
    }
  }

  pass.summary.distinctMapsPlayed = maps.size;
  return pass;
}

function bumpBucket(
  map: Map<string, ProgressionBucket>,
  key: string,
  pp: number,
  accuracy: number,
  graded: boolean,
) {
  const b = map.get(key) ?? { playCount: 0, totalPp: 0, accSum: 0, accCount: 0 };
  b.playCount += 1;
  b.totalPp += pp;
  if (graded) {
    b.accSum += accuracy;
    b.accCount += 1;
  }
  map.set(key, b);
}

/** Variant rating (star + LN ratio) for a modded play, or null for NM plays. */
type DanVariantRating = { star: number; lnRatio: number };

function loadDanVariantLookup(
  db: Db,
  plays: PlayCandidate[],
): (play: PlayCandidate) => DanVariantRating | null {
  // Only modded plays read the variants store; NM plays use the base rating.
  const beatmapIds = [
    ...new Set(
      plays.filter((p) => resolveDanVariant(p.mods)).map((p) => p.beatmapId),
    ),
  ];
  const ratings = loadDanVariantRatingsSync(db, beatmapIds, REWORK_ALGORITHM);
  return (play) => {
    const variant = resolveDanVariant(play.mods);
    if (!variant) return null;
    const stored = ratings.get(danVariantKey(play.beatmapId, variant));
    if (!stored) return null;
    return { star: stored.star!, lnRatio: stored.lnRatio! };
  };
}

/** Dan rating (base or variant) for a play; null when unrated. */
function danRatingFor(
  play: PlayCandidate,
  variantOf: (play: PlayCandidate) => DanVariantRating | null,
): { star: number; lnRatio: number } | null {
  const variant = variantOf(play);
  if (variant) return variant;
  // NM-equivalent play: read the base rework ratings store.
  if (resolveDanVariant(play.mods)) return null;
  if (play.reworkStar == null || play.lnRatio == null) return null;
  return { star: Number(play.reworkStar), lnRatio: Number(play.lnRatio) };
}

/**
 * Rank distribution with SH→S. SS = X/XH grade (Perfect/Marvelous). X = 1,000,000 only.
 * Fails (rank F / -1) are excluded. Each score is counted once.
 */
function getRankDistribution(byLabel: Map<string, number>) {
  return RANK_BUCKETS.map((b, i) => ({
    rank: i,
    label: b.key,
    count: byLabel.get(b.key) ?? 0,
  }));
}

function getSkillsetMix(
  plays: PlayCandidate[],
  variantOf: (play: PlayCandidate) => DanVariantRating | null,
  thresholds: AxisThresholds = DEFAULT_AXIS_THRESHOLDS,
) {
  let rc = 0;
  let ln = 0;
  let fln = 0;
  for (const play of plays) {
    const rating = danRatingFor(play, variantOf);
    if (!rating) continue;
    const axis = classifyMapAxis(rating.lnRatio, thresholds);
    if (axis === "fln") fln += 1;
    else if (axis === "ln") ln += 1;
    else rc += 1;
  }
  const total = rc + ln + fln;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return {
    rc,
    ln,
    fln,
    total,
    rcPct: pct(rc),
    lnPct: pct(ln),
    flnPct: pct(fln),
  };
}

/**
 * Chart-shape skill stats ("Patterns" section): per band (Push / Accuracy /
 * Consistency) and per Rice/LN/FLN axis, the same clear level Current skill
 * computes, restricted to plays whose map's primary chart shape is that family.
 *
 * Full-LN Invert plays are skipped (the stored shape does not describe the
 * converted chart); rate-only modded plays keep the base chart's shape and read
 * their variant star. Empty / null `shape_pattern` rows stay out — an empty
 * walk is not a chart-shape family.
 */
export const PATTERN_SHAPE_MIN_MAPS = 5;

/** Level + map count for one (band, axis) cell. */
export type PatternShapeAxisStat = {
  level: number;
  /** Maps counted for the cell — axis-filtered within the top-N slice. */
  maps: number;
};

export type PatternShapeStat = {
  shape: string;
  bands: Record<
    SkillBandKind,
    { all: PatternShapeAxisStat; rc: PatternShapeAxisStat; ln: PatternShapeAxisStat; fln: PatternShapeAxisStat }
  >;
};

export type PatternShapesStats = {
  /** Maps in band + axis before a shape's level is ranked. */
  floor: number;
  /** Sorted deterministically (push / all level desc, then shape name). */
  shapes: PatternShapeStat[];
};

function getPatternShapes(
  candidates: PlayCandidate[],
  opts: {
    variantOf: (play: PlayCandidate) => DanVariantRating | null;
    thresholds: AxisThresholds;
    focus: RecommendFocusSettings;
    topN: number;
  },
): PatternShapesStats {
  const { variantOf, thresholds, focus, topN } = opts;
  const shapeRows = new Map<string, SkillPlayRow[]>();
  for (const play of candidates) {
    if (!play.shape) continue;
    const rating = danRatingFor(play, variantOf);
    if (!rating) continue;
    if (resolveDanVariant(play.mods)?.lnOnly) continue;
    let rows = shapeRows.get(play.shape);
    if (!rows) {
      rows = [];
      shapeRows.set(play.shape, rows);
    }
    rows.push({
      beatmapId: play.beatmapId,
      accuracy: play.accuracy,
      playedAt: play.playedAt,
      reworkStar: rating.star,
      lnRatio: rating.lnRatio,
    });
  }

  const shapes: PatternShapeStat[] = [];
  for (const [shape, rows] of shapeRows) {
    const bands = {} as PatternShapeStat["bands"];
    for (const band of ["push", "accuracy", "consistency"] as const) {
      const range = skillBandAccRange(band, focus);
      const levels = bandLevelsFromPlays(
        rows,
        range.min,
        topN,
        bandCenter(focus[band]),
        bandHalfWidth(focus[band]),
        thresholds,
        range.max,
      );
      const cell = (v: { level: number; playCount: number }) => ({
        level: v.level,
        maps: v.playCount,
      });
      bands[band] = {
        all: cell(levels.all),
        rc: cell(levels.rc),
        ln: cell(levels.ln),
        fln: cell(levels.fln),
      };
    }
    shapes.push({ shape, bands });
  }
  shapes.sort(
    (a, b) =>
      b.bands.push.all.level - a.bands.push.all.level ||
      b.bands.push.all.maps - a.bands.push.all.maps ||
      a.shape.localeCompare(b.shape),
  );
  return { floor: PATTERN_SHAPE_MIN_MAPS, shapes };
}

function getPlayTimePatterns(pass: ManiaPass) {
  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    byHour: pass.byHour.map((count, hour) => ({ hour, count })),
    byDayOfWeek: pass.byDayOfWeek.map((count, day) => ({
      day,
      label: dayLabels[day]!,
      count,
    })),
  };
}

/**
 * Session header stats for the same rows as `streamManiaPass`: username,
 * gamemode, non-deleted scores, non-deleted sets, mania, and the selected
 * key count. Only sessions that contain at least one such play count.
 */
function getSessionStats(db: Db, user: ScoreScope, keyCount: number) {
  // One grouped pass: per-session scoped play and PB counts. The null group
  // holds PBs that belong to no session; they count toward pbCount only.
  const groups = db.$client
    .query(
      `
      SELECT sm.session_id AS id,
             ss.started_at AS startedAt,
             ss.ended_at AS endedAt,
             COUNT(*) AS scoreCount,
             SUM(sm.is_pb) AS pbCount
      FROM score_metrics sm
      JOIN scores s ON s.id = sm.score_id
      JOIN beatmaps b ON b.id = s.beatmap_id
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      LEFT JOIN sessions ss ON ss.id = sm.session_id
      WHERE s.delete_pending = 0
        ${user.sql}
        AND COALESCE(bs.delete_pending, 0) = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = ?
      GROUP BY sm.session_id
      ORDER BY sm.session_id ASC
    `,
    )
    .all(...user.params, keyCount) as Array<{
    id: number | null;
    startedAt: number | null;
    endedAt: number | null;
    scoreCount: number;
    pbCount: number | null;
  }>;

  let totalDurationMs = 0;
  let durationCount = 0;
  let totalScores = 0;
  let sessionCount = 0;
  let pbCount = 0;
  let longest: {
    id: number;
    scoreCount: number;
    startedAt: number;
    endedAt: number | null;
  } | null = null;

  for (const g of groups) {
    pbCount += Number(g.pbCount ?? 0);
    if (g.id == null) continue;
    sessionCount += 1;
    const scoreCount = Number(g.scoreCount);
    totalScores += scoreCount;
    const start = toMs(g.startedAt);
    const end = toMs(g.endedAt);
    if (start != null && end != null && end >= start) {
      const dur = end - start;
      totalDurationMs += dur;
      durationCount += 1;
    }
    if (!longest || scoreCount > longest.scoreCount) {
      longest = {
        id: g.id,
        scoreCount,
        startedAt: start ?? 0,
        endedAt: end,
      };
    }
  }

  return {
    sessionCount,
    pbCount,
    avgPlaysPerSession: sessionCount > 0 ? totalScores / sessionCount : 0,
    avgDurationMs: durationCount > 0 ? totalDurationMs / durationCount : null,
    longest,
  };
}

/**
 * Fold one rated-map entry per (mapper, beatmap, variant) into the aggregate.
 * NM plays read the base rework rating; modded plays need a computed variant.
 * Unrated or hidden plays contribute nothing to the rated columns.
 */
function foldMapperRatings(
  pass: ManiaPass,
  variantOf: (play: PlayCandidate) => DanVariantRating | null,
) {
  for (const play of pass.candidates) {
    if (!play.mapperKey) continue;
    const agg = pass.byMapper.get(play.mapperKey);
    if (!agg) continue;
    const rating = danRatingFor(play, variantOf);
    if (!rating) continue;
    const variant = resolveDanVariant(play.mods);
    // NM maps key on the base rating; each modded (beatmap, variant) stands alone.
    const key = variant
      ? danVariantKey(play.beatmapId, variant)
      : `${play.beatmapId}|nm`;
    if (!agg.rated.has(key)) {
      agg.rated.set(key, rating);
    }
  }
}

/**
 * Build the top mappers table: play volume from the streamed aggregates,
 * axis split and Rework star mean over the distinct rated entries. Ranked by
 * plays, then distinct maps, then name — the PP tiebreak is gone with PP.
 */
function buildTopMappers(
  byMapper: Map<string, MapperViewAgg>,
  thresholds: AxisThresholds,
  limit = 10,
): TopMapperStat[] {
  const rows: TopMapperStat[] = [];
  for (const [key, agg] of byMapper) {
    let rc = 0;
    let ln = 0;
    let fln = 0;
    let starSum = 0;
    for (const rated of agg.rated.values()) {
      const axis = classifyMapAxis(rated.lnRatio, thresholds);
      if (axis === "fln") fln += 1;
      else if (axis === "ln") ln += 1;
      else rc += 1;
      starSum += rated.star;
    }
    const ratedMaps = agg.rated.size;
    rows.push({
      mapperOnlineId: mapperOnlineIdFromGroupKey(key),
      mapperUsername: dominantMapperUsername(agg.usernameCounts),
      playCount: agg.playCount,
      mapsPlayed: agg.beatmapIds.size,
      avgAccuracy:
        agg.accCount > 0 ? agg.accSum / agg.accCount : null,
      sessionCount: agg.sessionIds.size,
      rcMaps: rc,
      lnMaps: ln,
      flnMaps: fln,
      ratedMaps,
      avgStar: ratedMaps > 0 ? starSum / ratedMaps : null,
    });
  }
  return rows
    .sort(
      (a, b) =>
        b.playCount - a.playCount ||
        b.mapsPlayed - a.mapsPlayed ||
        (a.mapperUsername ?? "").localeCompare(b.mapperUsername ?? "") ||
        b.mapperOnlineId - a.mapperOnlineId,
    )
    .slice(0, limit);
}

function getKeymodeProgression(
  daily: Map<string, ProgressionBucket>,
  weekly: Map<string, ProgressionBucket>,
) {
  const ppTrend = [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, b]) => ({
      day,
      totalPp: b.totalPp,
      playCount: b.playCount,
    }));

  const accuracyTrend = [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, b]) => ({
      day,
      avgAccuracy: b.accCount > 0 ? b.accSum / b.accCount : null,
      playCount: b.playCount,
    }));

  const weeklyActivity = [...weekly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, b]) => ({
      weekStart,
      playCount: b.playCount,
      totalPp: b.totalPp,
      avgAccuracy: b.playCount > 0 ? b.accSum / b.playCount : null,
    }));

  return { ppTrend, accuracyTrend, weeklyActivity };
}

export async function getPlayerStats(db: Db, query: PlayerStatsQuery = {}) {
  const granularity = parseGranularity(query.granularity);
  const skillTopPlays = parseSkillTopPlays(query.skillTopPlays);
  const keyCount = parseSkillKeyCount(query.keyCount ?? DEFAULT_SKILL_KEY_COUNT);

  // Resolve the score scope (username + gamemode) once for every query below.
  const scope = scoreScopeFilter(db);
  const availableKeyCounts = listPlayedKeyCounts(db, scope);
  const curves = loadManiaPpCurvesSync(db);
  const pass = streamManiaPass(db, scope, keyCount, curves);
  const variantOf = loadDanVariantLookup(db, pass.candidates);
  const axisThresholds = readAxisThresholdsSync(db);
  const focusSettings = readFocusSettingsSync(db);

  const [beatmapCountRow] = await db
    .select({ n: count() })
    .from(beatmaps)
    .where(
      and(
        eq(beatmaps.hidden, false),
        sql`lower(coalesce(${beatmaps.rulesetShortName}, '')) = 'mania'`,
        eq(beatmaps.circleSize, keyCount),
      ),
    );

  const skillPlays = [];
  for (const play of pass.candidates) {
    const rating = danRatingFor(play, variantOf);
    if (!rating) continue;
    skillPlays.push({
      beatmapId: play.beatmapId,
      accuracy: play.accuracy,
      playedAt: play.playedAt,
      reworkStar: rating.star,
      lnRatio: rating.lnRatio,
    });
  }
  // All-time span: every scoped local play from the earliest through today.
  // Inclusive day count so the first play's day is sampled (>= 1).
  const firstPlayed = pass.summary.firstPlayedAt;
  const rangeDays =
    firstPlayed == null
      ? 1
      : Math.max(
          1,
          Math.ceil(
            (Date.now() - firstPlayed) / 86_400_000,
          ),
        );

  const skillBundle = estimateSevenKSkillWithHistoryFromPlays(skillPlays, {
    granularity,
    rangeDays,
    topPlays: skillTopPlays || focusSettings.topPlays,
    keyCount,
    axisThresholds,
    focusSettings,
  });
  const progression = getKeymodeProgression(pass.daily, pass.weekly);
  const rankDistribution = getRankDistribution(pass.rankByLabel);
  const skillsetMix = getSkillsetMix(pass.candidates, variantOf, axisThresholds);
  const patternShapes = getPatternShapes(pass.candidates, {
    variantOf,
    thresholds: axisThresholds,
    focus: focusSettings,
    topN: skillTopPlays || focusSettings.topPlays,
  });
  const playPatterns = getPlayTimePatterns(pass);
  const sessionStats = getSessionStats(db, scope, keyCount);
  foldMapperRatings(pass, variantOf);
  const topMappers = buildTopMappers(pass.byMapper, axisThresholds, 10);

  const summary = {
    ...pass.summary,
    beatmapCount: beatmapCountRow?.n ?? 0,
  };

  return {
    granularity,
    skillTopPlays,
    keyCount,
    availableKeyCounts,
    summary: {
      ...summary,
      sessionCount: sessionStats.sessionCount,
      pbCount: sessionStats.pbCount,
    },
    skill: skillBundle.skill,
    skillHistory: skillBundle.skillHistory,
    ppTrend: progression.ppTrend,
    accuracyTrend: progression.accuracyTrend,
    weeklyActivity: progression.weeklyActivity,
    rankDistribution,
    skillsetMix,
    patternShapes,
    playByHour: playPatterns.byHour,
    playByDayOfWeek: playPatterns.byDayOfWeek,
    sessionStats: {
      avgPlaysPerSession: sessionStats.avgPlaysPerSession,
      avgDurationMs: sessionStats.avgDurationMs,
      longest: sessionStats.longest,
    },
    topMappers,
  };
}

export {
  parseGranularity,
  parseSkillTopPlays,
  parseSkillKeyCount,
  PERFECT_TOTAL_SCORE,
  DEFAULT_SKILL_KEY_COUNT,
};
