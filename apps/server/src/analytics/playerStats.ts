import { and, count, desc, eq, sql, type Db } from "@roxysu/db/client.bun";
import {
  beatmaps,
  mapperStats,
  scoreMetrics,
  scores,
  sessions,
} from "@roxysu/db/client.bun";
import { SUNNY_ALGORITHM } from "../map-analysis/computeSunnyDan";
import {
  getAccuracyTrend,
  getPpTrend,
  getWeeklyActivity,
} from "./progression";
import { classifyMapAxis } from "./recommend/axis";
import {
  estimateSevenKSkill,
  estimateSevenKSkillHistory,
} from "./recommend/sevenKSkill";

/** Display buckets for the rank chart (silver grades folded into gold). */
const RANK_BUCKETS = [
  { key: "F", ranks: [-1] },
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

/**
 * Rank distribution with SH→S, XH→X, plus any 1,000,000 total score as X.
 * Each score is counted once (perfect score wins over letter rank).
 */
async function getRankDistribution(db: Db) {
  const rows = db.$client
    .query(
      `
      SELECT
        CASE
          WHEN s.total_score = ? OR s.rank IN (6, 7) THEN 'X'
          WHEN s.rank IN (4, 5) THEN 'S'
          WHEN s.rank = 3 THEN 'A'
          WHEN s.rank = 2 THEN 'B'
          WHEN s.rank = 1 THEN 'C'
          WHEN s.rank = 0 THEN 'D'
          WHEN s.rank = -1 THEN 'F'
          ELSE NULL
        END AS label,
        COUNT(*) AS count
      FROM scores s
      WHERE s.delete_pending = 0
      GROUP BY label
    `,
    )
    .all(PERFECT_TOTAL_SCORE) as Array<{ label: string | null; count: number }>;

  const byLabel = new Map(
    rows
      .filter((r) => r.label != null)
      .map((r) => [r.label!, Number(r.count)]),
  );

  return RANK_BUCKETS.map((b, i) => ({
    rank: i,
    label: b.key,
    count: byLabel.get(b.key) ?? 0,
  }));
}

async function getSkillsetMix(db: Db) {
  const rows = db.$client
    .query(
      `
      SELECT dr.ln_ratio AS lnRatio, COUNT(*) AS playCount
      FROM scores s
      JOIN beatmaps b ON b.id = s.beatmap_id
      LEFT JOIN beatmap_sets bs ON bs.id = b.set_id
      LEFT JOIN beatmap_dan_ratings dr
        ON dr.beatmap_id = b.id AND dr.algorithm = ?
      WHERE s.delete_pending = 0
        AND b.hidden = 0
        AND COALESCE(bs.delete_pending, 0) = 0
        AND LOWER(COALESCE(b.ruleset_short_name, '')) = 'mania'
        AND b.circle_size = 7
      GROUP BY dr.ln_ratio
    `,
    )
    .all(SUNNY_ALGORITHM) as Array<{ lnRatio: number | null; playCount: number }>;

  let rc = 0;
  let ln = 0;
  let fln = 0;
  for (const row of rows) {
    const n = Number(row.playCount ?? 0);
    const axis = classifyMapAxis(
      row.lnRatio != null ? Number(row.lnRatio) : null,
    );
    if (axis === "fln") fln += n;
    else if (axis === "ln") ln += n;
    else rc += n;
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

async function getPlayTimePatterns(db: Db) {
  const rows = db.$client
    .query(
      `
      SELECT played_at AS playedAt
      FROM scores
      WHERE delete_pending = 0
    `,
    )
    .all() as Array<{ playedAt: number }>;

  const byHour = Array.from({ length: 24 }, () => 0);
  const byDayOfWeek = Array.from({ length: 7 }, () => 0); // 0 = Sunday UTC

  for (const row of rows) {
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

async function getTopMappers(db: Db, limit = 10) {
  const rows = await db
    .select()
    .from(mapperStats)
    .orderBy(desc(mapperStats.playCount))
    .limit(limit);

  return rows.map((r) => ({
    mapperOnlineId: r.mapperOnlineId,
    mapperUsername: r.mapperUsername,
    playCount: r.playCount,
    totalPp: r.totalPp,
    avgAccuracy: r.avgAccuracy,
  }));
}

async function getSummary(db: Db) {
  const [scoreCount] = await db
    .select({ n: count() })
    .from(scores)
    .where(eq(scores.deletePending, false));

  const [beatmapCount] = await db.select({ n: count() }).from(beatmaps);

  const [distinctMaps] = await db
    .select({
      n: sql<number>`count(distinct ${scores.beatmapId})`,
    })
    .from(scores)
    .where(
      and(eq(scores.deletePending, false), sql`${scores.beatmapId} is not null`),
    );

  const bounds = db.$client
    .query(
      `
      SELECT MIN(played_at) AS firstAt, MAX(played_at) AS lastAt
      FROM scores
      WHERE delete_pending = 0
    `,
    )
    .get() as { firstAt: number | null; lastAt: number | null } | null;

  return {
    scoreCount: scoreCount?.n ?? 0,
    beatmapCount: beatmapCount?.n ?? 0,
    distinctMapsPlayed: Number(distinctMaps?.n ?? 0),
    firstPlayedAt: bounds?.firstAt != null ? Number(bounds.firstAt) : null,
    lastPlayedAt: bounds?.lastAt != null ? Number(bounds.lastAt) : null,
  };
}

export async function getPlayerStats(db: Db, query: PlayerStatsQuery = {}) {
  const granularity = parseGranularity(query.granularity);
  const range = parseRange(query.range);

  const trendDays = range;
  const weekCount = Math.max(12, Math.ceil(range / 7));

  const [
    summary,
    skill,
    skillHistory,
    ppTrend,
    accuracyTrend,
    weeklyActivity,
    rankDistribution,
    skillsetMix,
    playPatterns,
    sessionStats,
    topMappers,
  ] = await Promise.all([
    getSummary(db),
    Promise.resolve(estimateSevenKSkill(db)),
    Promise.resolve(
      estimateSevenKSkillHistory(db, { granularity, rangeDays: range }),
    ),
    getPpTrend(db, trendDays),
    getAccuracyTrend(db, trendDays),
    getWeeklyActivity(db, weekCount),
    getRankDistribution(db),
    getSkillsetMix(db),
    getPlayTimePatterns(db),
    getSessionStats(db),
    getTopMappers(db, 10),
  ]);

  return {
    granularity,
    range,
    summary: {
      ...summary,
      sessionCount: sessionStats.sessionCount,
      pbCount: sessionStats.pbCount,
    },
    skill,
    skillHistory,
    ppTrend,
    accuracyTrend,
    weeklyActivity,
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

export { parseGranularity, parseRange, PERFECT_TOTAL_SCORE };
