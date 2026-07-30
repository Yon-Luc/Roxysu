

import type { Db } from "@roxysu/db/types";
import { beatmaps, scoreMetrics, scores, sessions } from "@roxysu/db/schema";
import { and, count, eq, sql } from "drizzle-orm";
import { SUNNY_ALGORITHM } from "../map-analysis/computeSunnyDan";
import { isNomodOrMirrorOnly } from "../replay/mods";
import { classifyMapAxis } from "./recommend/axis";
import {
  DEFAULT_SKILL_KEY_COUNT,
  estimateSevenKSkillWithHistory,
  parseSkillKeyCount,
  parseSkillTopPlays,
} from "./recommend/sevenKSkill";

/** Display buckets for the rank chart (silver grades folded into gold). Fails omitted. */
const RANK_BUCKETS = [
  { key: "D", ranks: [0] },
  { key: "C", ranks: [1] },
  { key: "B", ranks: [2] },
  { key: "A", ranks: [3] },
  { key: "S", ranks: [4, 5] }, // S + SH
  { key: "X", ranks: [6, 7] }, // X + XH; also 1M score below
] as const;

/** Mania max / perfect score (ScoreV1-style ceiling). */
const PERFECT_TOTAL_SCORE = 1_000_000;

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
  const rows = db.$client
    .query(
      `
      SELECT DISTINCT CAST(b.circle_size AS INTEGER) AS keyCount
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      WHERE s.delete_pending = 0
        AND b.hidden = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size IS NOT NULL
      ORDER BY keyCount ASC
    `,
    )
    .all() as Array<{ keyCount: number }>;

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
 * Rank distribution with SH→S, XH→X, plus any 1,000,000 total score as X.
 * Fails (rank F / -1) are excluded. Each score is counted once (perfect wins).
 */
async function getRankDistribution(db: Db, keyCount: number) {
  const rows = db.$client
    .query(
      `
      SELECT
        s.total_score AS totalScore,
        s.rank AS rank,
        s.mods AS mods
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      WHERE s.delete_pending = 0
        AND s.rank != -1
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = ?
    `,
    )
    .all(keyCount) as Array<{
    totalScore: number;
    rank: number;
    mods: string | null;
  }>;

  const byLabel = new Map<string, number>();
  for (const row of rows) {
    if (!isNomodOrMirrorOnly(row.mods)) continue;
    let label: string | null = null;
    if (Number(row.totalScore) === PERFECT_TOTAL_SCORE || row.rank === 6 || row.rank === 7) {
      label = "X";
    } else if (row.rank === 4 || row.rank === 5) {
      label = "S";
    } else if (row.rank === 3) label = "A";
    else if (row.rank === 2) label = "B";
    else if (row.rank === 1) label = "C";
    else if (row.rank === 0) label = "D";
    if (!label) continue;
    byLabel.set(label, (byLabel.get(label) ?? 0) + 1);
  }

  return RANK_BUCKETS.map((b, i) => ({
    rank: i,
    label: b.key,
    count: byLabel.get(b.key) ?? 0,
  }));
}

async function getSkillsetMix(db: Db, keyCount: number) {
  const rows = db.$client
    .query(
      `
      SELECT dr.ln_ratio AS lnRatio, s.mods AS mods
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE s.delete_pending = 0
        AND b.hidden = 0
        AND COALESCE(bs.delete_pending, 0) = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = ?
    `,
    )
    .all(SUNNY_ALGORITHM, keyCount) as Array<{
    lnRatio: number | null;
    mods: string | null;
  }>;

  let rc = 0;
  let ln = 0;
  let fln = 0;
  for (const row of rows) {
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

async function getPlayTimePatterns(db: Db, keyCount: number) {
  const rows = db.$client
    .query(
      `
      SELECT s.played_at AS playedAt, s.mods AS mods
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      WHERE s.delete_pending = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = ?
    `,
    )
    .all(keyCount) as Array<{ playedAt: number; mods: string | null }>;

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

async function getTopMappers(db: Db, keyCount: number, limit = 10) {
  const rows = db.$client
    .query(
      `
      SELECT
        b.mapper_online_id AS mapperOnlineId,
        b.mapper_username AS mapperUsername,
        s.accuracy AS accuracy,
        s.pp AS pp,
        s.mods AS mods
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      WHERE s.delete_pending = 0
        AND b.mapper_online_id IS NOT NULL
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = ?
    `,
    )
    .all(keyCount) as Array<{
    mapperOnlineId: number;
    mapperUsername: string | null;
    accuracy: number;
    pp: number | null;
    mods: string | null;
  }>;

  const byMapper = new Map<
    number,
    { mapperUsername: string | null; playCount: number; totalPp: number; accSum: number }
  >();
  for (const row of rows) {
    if (!isNomodOrMirrorOnly(row.mods)) continue;
    const id = Number(row.mapperOnlineId);
    const cur = byMapper.get(id) ?? {
      mapperUsername: row.mapperUsername,
      playCount: 0,
      totalPp: 0,
      accSum: 0,
    };
    cur.playCount += 1;
    cur.totalPp += row.pp ?? 0;
    cur.accSum += Number(row.accuracy ?? 0);
    cur.mapperUsername = row.mapperUsername ?? cur.mapperUsername;
    byMapper.set(id, cur);
  }

  return [...byMapper.entries()]
    .map(([mapperOnlineId, b]) => ({
      mapperOnlineId,
      mapperUsername: b.mapperUsername,
      playCount: b.playCount,
      totalPp: b.totalPp,
      avgAccuracy: b.playCount > 0 ? b.accSum / b.playCount : null,
    }))
    .sort((a, b) => b.playCount - a.playCount || b.totalPp - a.totalPp)
    .slice(0, limit);
}

async function getKeymodeProgression(
  db: Db,
  keyCount: number,
  days: number,
  weeks: number,
) {
  const rows = db.$client
    .query(
      `
      SELECT
        s.played_at AS playedAt,
        s.accuracy AS accuracy,
        s.pp AS pp,
        s.mods AS mods
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      WHERE s.delete_pending = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = ?
    `,
    )
    .all(keyCount) as Array<{
    playedAt: number;
    accuracy: number;
    pp: number | null;
    mods: string | null;
  }>;

  type Bucket = { playCount: number; totalPp: number; accSum: number };
  const daily = new Map<string, Bucket>();
  const weekly = new Map<string, Bucket>();

  for (const row of rows) {
    if (!isNomodOrMirrorOnly(row.mods)) continue;
    const ms = Number(row.playedAt ?? 0);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    const played = new Date(ms);
    const pp = row.pp ?? 0;
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

async function getSummary(db: Db, keyCount: number) {
  const rows = db.$client
    .query(
      `
      SELECT
        s.beatmap_id AS beatmapId,
        s.played_at AS playedAt,
        s.mods AS mods
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      WHERE s.delete_pending = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = ?
    `,
    )
    .all(keyCount) as Array<{
    beatmapId: string | null;
    playedAt: number;
    mods: string | null;
  }>;

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

  const [beatmapCount] = await db
    .select({ n: count() })
    .from(beatmaps)
    .where(
      and(
        eq(beatmaps.hidden, false),
        sql`lower(coalesce(${beatmaps.rulesetShortName}, '')) = 'mania'`,
        eq(beatmaps.circleSize, keyCount),
      ),
    );

  return {
    scoreCount,
    beatmapCount: beatmapCount?.n ?? 0,
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

  // Defer sync skill work so other DB queries can start in the same tick.
  const skillBundlePromise = Promise.resolve().then(() =>
    estimateSevenKSkillWithHistory(db, {
      granularity,
      rangeDays: range,
      topPlays: skillTopPlays,
      keyCount,
    }),
  );

  const [
    summary,
    skillBundle,
    progression,
    rankDistribution,
    skillsetMix,
    playPatterns,
    sessionStats,
    topMappers,
  ] = await Promise.all([
    getSummary(db, keyCount),
    skillBundlePromise,
    getKeymodeProgression(db, keyCount, trendDays, weekCount),
    getRankDistribution(db, keyCount),
    getSkillsetMix(db, keyCount),
    getPlayTimePatterns(db, keyCount),
    getSessionStats(db),
    getTopMappers(db, keyCount, 10),
  ]);

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
