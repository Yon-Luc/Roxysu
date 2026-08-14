

import type { Db } from "@roxysu/db/types";
import { beatmaps, scoreMetrics, sessions } from "@roxysu/db/schema";
import { and, count, eq, sql } from "drizzle-orm";
import { SUNNY_ALGORITHM } from "../map-analysis/computeSunnyDan";
import { isNomodOrMirrorOnly } from "../replay/mods";
import { classifyMapAxis } from "./recommend/axis";
import { classifyScoreGrade, PERFECT_TOTAL_SCORE } from "../query-language/scoreGrade";
import {
  DEFAULT_SKILL_KEY_COUNT,
  estimateSevenKSkillWithHistoryFromPlays,
  parseSkillKeyCount,
  parseSkillTopPlays,
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
  bumpMapperAgg,
  compareMapperAgg,
  createMapperAgg,
  dominantMapperUsername,
  mapperGroupKey,
  mapperOnlineIdFromGroupKey,
  type MapperAgg,
} from "./mapperUsername";

/** Username + gamemode SQL fragments for score-scoped analytics queries. */
function scoreScopeFilter(
  db: Db,
  opts?: { userColumn?: string; modeColumn?: string },
) {
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
export type StatsRange = 30 | 90 | 180;

export type PlayerStatsQuery = {
  granularity?: StatsGranularity;
  range?: StatsRange;
  skillTopPlays?: number;
  /** Single mania keymode — never mixed (default 7). */
  keyCount?: number;
};

function parseRange(raw: unknown): StatsRange {
  const n = Number(raw);
  if (n === 90 || n === 180) return n;
  return 30;
}

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

function listPlayedKeyCounts(db: Db): number[] {
  const user = scoreScopeFilter(db);
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
 * Rank distribution with SH→S. SS = X/XH grade (Perfect/Marvelous). X = 1,000,000 only.
 * Fails (rank F / -1) are excluded. Each score is counted once.
 */
type ManiaAnalyticsRow = {
  beatmapId: string | null;
  playedAt: number;
  mods: string | null;
  accuracy: number;
  pp: number | null;
  totalScore: number;
  rank: number;
  rulesetShortName: string | null;
  lnRatio: number | null;
  sunnyStar: number | null;
  mapperOnlineId: number | null;
  mapperUsername: string | null;
  hidden: number;
};

function loadManiaAnalyticsRows(db: Db, keyCount: number): ManiaAnalyticsRow[] {
  const user = scoreScopeFilter(db);
  return db.$client
    .query(
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
        dr.sunny_star AS sunnyStar,
        b.mapper_online_id AS mapperOnlineId,
        b.mapper_username AS mapperUsername,
        b.hidden AS hidden
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE s.delete_pending = 0
        ${user.sql}
        AND COALESCE(bs.delete_pending, 0) = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = ?
    `,
    )
    .all(SUNNY_ALGORITHM, ...user.params, keyCount) as ManiaAnalyticsRow[];
}

async function getRankDistribution(rows: ManiaAnalyticsRow[]) {

  const byLabel = new Map<string, number>();
  for (const row of rows) {
    if (row.rank === -1) continue;
    if (!isNomodOrMirrorOnly(row.mods)) continue;
    const label = classifyScoreGrade(Number(row.totalScore), row.rank);
    if (!label) continue;
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
  }

  return RANK_BUCKETS.map((b, i) => ({
    rank: i,
    label: b.key,
    count: byLabel.get(b.key) ?? 0,
  }));
}

async function getSkillsetMix(rows: ManiaAnalyticsRow[]) {
  let rc = 0;
  let ln = 0;
  let fln = 0;
  for (const row of rows) {
    if (row.hidden) continue;
    if (!isNomodOrMirrorOnly(row.mods)) continue;
    const axis = classifyMapAxis(
      row.lnRatio != null ? Number(row.lnRatio) : null,
    );
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

async function getPlayTimePatterns(rows: ManiaAnalyticsRow[]) {

  const byHour = Array.from({ length: 24 }, () => 0);
  const byDayOfWeek = Array.from({ length: 7 }, () => 0); // 0 = Sunday UTC

  for (const row of rows) {
    if (!isNomodOrMirrorOnly(row.mods)) continue;
    const ms = Number(row.playedAt ?? 0);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    const d = new Date(ms);
    byHour[d.getUTCHours()]! += 1;
    byDayOfWeek[d.getUTCDay()]! += 1;
  }

  const dayLabels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return {
    byHour: byHour.map((count, hour) => ({ hour, count })),
    byDayOfWeek: byDayOfWeek.map((count, day) => ({
      day,
      label: dayLabels[day]!,
      count,
    })),
  };
}

async function getSessionStats(db: Db) {
  const allSessions = await db.select().from(sessions);
  let totalDurationMs = 0;
  let durationCount = 0;
  let totalScores = 0;
  let longest: {
    id: number;
    scoreCount: number;
    startedAt: number;
    endedAt: number | null;
  } | null = null;

  for (const s of allSessions) {
    totalScores += s.scoreCount;
    const start = toMs(s.startedAt);
    const end = toMs(s.endedAt);
    if (start != null && end != null && end >= start) {
      const dur = end - start;
      totalDurationMs += dur;
      durationCount += 1;
    }
    if (!longest || s.scoreCount > longest.scoreCount) {
      longest = {
        id: s.id,
        scoreCount: s.scoreCount,
        startedAt: start ?? 0,
        endedAt: end,
      };
    }
  }

  const [pbRow] = await db
    .select({ n: count() })
    .from(scoreMetrics)
    .where(eq(scoreMetrics.isPb, true));

  const sessionCount = allSessions.length;
  return {
    sessionCount,
    pbCount: pbRow?.n ?? 0,
    avgPlaysPerSession: sessionCount > 0 ? totalScores / sessionCount : 0,
    avgDurationMs: durationCount > 0 ? totalDurationMs / durationCount : null,
    longest,
  };
}

async function getTopMappers(
  rows: ManiaAnalyticsRow[],
  curves: Map<string, ManiaPpCurve>,
  limit = 10,
) {
  const byMapper = new Map<string, MapperAgg>();
  for (const row of rows) {
    if (!isNomodOrMirrorOnly(row.mods)) continue;
    const key = mapperGroupKey(row.mapperOnlineId, row.mapperUsername);
    if (!key) continue;
    const cur = byMapper.get(key) ?? createMapperAgg();
    bumpMapperAgg(
      cur,
      Number(row.accuracy ?? 0),
      resolveScorePp({
        pp: row.pp,
        accuracy: row.accuracy,
        mods: row.mods,
        rulesetShortName: row.rulesetShortName,
        curve: row.beatmapId ? curves.get(row.beatmapId) : undefined,
      }) ?? 0,
      row.mapperUsername,
    );
    byMapper.set(key, cur);
  }

  return [...byMapper.entries()]
    .sort(([, a], [, b]) => compareMapperAgg(a, b))
    .slice(0, limit)
    .map(([key, b]) => ({
      mapperOnlineId: mapperOnlineIdFromGroupKey(key),
      mapperUsername: dominantMapperUsername(b.usernameCounts),
      playCount: b.playCount,
      totalPp: b.totalPp,
      avgAccuracy: b.playCount > 0 ? b.accSum / b.playCount : null,
    }));
}

async function getKeymodeProgression(
  rows: ManiaAnalyticsRow[],
  days: number,
  weeks: number,
  curves: Map<string, ManiaPpCurve>,
) {
  type Bucket = { playCount: number; totalPp: number; accSum: number };
  const daily = new Map<string, Bucket>();
  const weekly = new Map<string, Bucket>();

  for (const row of rows) {
    if (!isNomodOrMirrorOnly(row.mods)) continue;
    const ms = Number(row.playedAt ?? 0);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    const played = new Date(ms);
    const pp =
      resolveScorePp({
        pp: row.pp,
        accuracy: row.accuracy,
        mods: row.mods,
        rulesetShortName: row.rulesetShortName,
        curve: row.beatmapId ? curves.get(row.beatmapId) : undefined,
      }) ?? 0;
    const dKey = dayKey(played);
    const wKey = weekStartKey(played);
    const bump = (map: Map<string, Bucket>, key: string) => {
      const b = map.get(key) ?? { playCount: 0, totalPp: 0, accSum: 0 };
      b.playCount += 1;
      b.totalPp += pp;
      b.accSum += Number(row.accuracy ?? 0);
      map.set(key, b);
    };
    bump(daily, dKey);
    bump(weekly, wKey);
  }

  const ppTrend = [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-days)
    .map(([day, b]) => ({
      day,
      totalPp: b.totalPp,
      playCount: b.playCount,
    }));

  const accuracyTrend = [...daily.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-days)
    .map(([day, b]) => ({
      day,
      avgAccuracy: b.playCount > 0 ? b.accSum / b.playCount : 0,
      playCount: b.playCount,
    }));

  const weeklyActivity = [...weekly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-weeks)
    .map(([weekStart, b]) => ({
      weekStart,
      playCount: b.playCount,
      totalPp: b.totalPp,
      avgAccuracy: b.playCount > 0 ? b.accSum / b.playCount : null,
    }));

  return { ppTrend, accuracyTrend, weeklyActivity };
}

function getSummaryFromRows(rows: ManiaAnalyticsRow[]) {
  const maps = new Set<string>();
  let scoreCount = 0;
  let firstAt: number | null = null;
  let lastAt: number | null = null;
  for (const row of rows) {
    if (!isNomodOrMirrorOnly(row.mods)) continue;
    scoreCount += 1;
    if (row.beatmapId) maps.add(row.beatmapId);
    const ms = Number(row.playedAt ?? 0);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    if (firstAt == null || ms < firstAt) firstAt = ms;
    if (lastAt == null || ms > lastAt) lastAt = ms;
  }
  return {
    scoreCount,
    distinctMapsPlayed: maps.size,
    firstPlayedAt: firstAt,
    lastPlayedAt: lastAt,
  };
}

export async function getPlayerStats(db: Db, query: PlayerStatsQuery = {}) {
  const granularity = parseGranularity(query.granularity);
  const range = parseRange(query.range);
  const skillTopPlays = parseSkillTopPlays(query.skillTopPlays);
  const keyCount = parseSkillKeyCount(query.keyCount ?? DEFAULT_SKILL_KEY_COUNT);

  const trendDays = range;
  const weekCount = Math.max(12, Math.ceil(range / 7));
  const availableKeyCounts = listPlayedKeyCounts(db);
  const curves = loadManiaPpCurvesSync(db);
  const rows = loadManiaAnalyticsRows(db, keyCount);

  const [
    beatmapCountRow,
    skillBundle,
    progression,
    rankDistribution,
    skillsetMix,
    playPatterns,
    sessionStats,
    topMappers,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(beatmaps)
      .where(
        and(
          eq(beatmaps.hidden, false),
          sql`lower(coalesce(${beatmaps.rulesetShortName}, '')) = 'mania'`,
          eq(beatmaps.circleSize, keyCount),
        ),
      )
      .then((rows) => rows[0]),
    Promise.resolve().then(() => {
      const plays = rows
        .filter(
          (row) =>
            !row.hidden &&
            isNomodOrMirrorOnly(row.mods) &&
            row.beatmapId != null,
        )
        .map((row) => ({
          beatmapId: row.beatmapId!,
          accuracy: Number(row.accuracy ?? 0),
          playedAt: Number(row.playedAt ?? 0),
          sunnyStar: row.sunnyStar != null ? Number(row.sunnyStar) : null,
          lnRatio: row.lnRatio != null ? Number(row.lnRatio) : null,
        }));
      return estimateSevenKSkillWithHistoryFromPlays(plays, {
        granularity,
        rangeDays: range,
        topPlays: skillTopPlays,
        keyCount,
      });
    }),
    getKeymodeProgression(rows, trendDays, weekCount, curves),
    getRankDistribution(rows),
    getSkillsetMix(rows),
    getPlayTimePatterns(rows),
    getSessionStats(db),
    getTopMappers(rows, curves, 10),
  ]);

  const summary = {
    ...getSummaryFromRows(rows),
    beatmapCount: beatmapCountRow?.n ?? 0,
  };

  return {
    granularity,
    range,
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
  parseRange,
  parseSkillTopPlays,
  parseSkillKeyCount,
  PERFECT_TOTAL_SCORE,
  DEFAULT_SKILL_KEY_COUNT,
};
