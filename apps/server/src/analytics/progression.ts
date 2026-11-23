import type { Db } from "@roxysu/db/types";
import { dailyStats, scores, weeklyStats } from "@roxysu/db/schema";
import { and, desc, eq, gte } from "drizzle-orm";
import { localDayKey } from "../shared/localDay";
import { scoresGamemodeCondition, resolveScoresGamemodeSync } from "./scoreGamemode";
import { resolveScoresUsernamesSync, scoresUsernameCondition } from "./scoreUsername";

/** Read-model helpers for dashboard PP/accuracy trends. */
export async function getPpTrend(db: Db, days = 30) {
  const rows = await db
    .select({
      day: dailyStats.day,
      totalPp: dailyStats.totalPp,
      playCount: dailyStats.playCount,
    })
    .from(dailyStats)
    .orderBy(desc(dailyStats.day))
    .limit(days);

  return rows
    .slice()
    .reverse()
    .map((r) => ({
      day: r.day,
      totalPp: r.totalPp,
      playCount: r.playCount,
    }));
}

export async function getAccuracyTrend(db: Db, days = 30) {
  const rows = await db
    .select({
      day: dailyStats.day,
      avgAccuracy: dailyStats.avgAccuracy,
      playCount: dailyStats.playCount,
    })
    .from(dailyStats)
    .orderBy(desc(dailyStats.day))
    .limit(days);

  return rows
    .slice()
    .reverse()
    .map((r) => ({
      day: r.day,
      avgAccuracy: r.avgAccuracy,
      playCount: r.playCount,
    }));
}

function utcWeekStartKey(d: Date): string {
  const copy = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy.toISOString().slice(0, 10);
}

function addUtcDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Last `weeks` UTC calendar weeks, including weeks with no plays.
 *
 * L-M4: these stored rows keep whatever accuracy formula produced them. After
 * an accuracy-formula change, an untouched week reads the old formula until a
 * full statistics rebuild runs — incremental score/import refreshes only
 * rewrite the partitions they touch. No automatic migration is intended.
 */
export async function getWeeklyActivity(db: Db, weeks = 12) {
  const count = Math.max(1, weeks);
  const thisWeek = utcWeekStartKey(new Date());
  const start = addUtcDays(thisWeek, -(count - 1) * 7);
  const rows = await db
    .select()
    .from(weeklyStats)
    .where(gte(weeklyStats.weekStart, start))
    .orderBy(desc(weeklyStats.weekStart));

  if (rows.length === 0) return [];
  const byWeek = new Map(rows.map((row) => [row.weekStart, row]));
  const keys: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    keys.push(addUtcDays(thisWeek, -i * 7));
  }
  const filled = keys.map((weekStart) => {
    const row = byWeek.get(weekStart);
    return {
      weekStart,
      playCount: row?.playCount ?? 0,
      totalPp: row?.totalPp ?? 0,
      avgAccuracy: row?.avgAccuracy ?? null,
    };
  });
  if (filled.every((week) => week.playCount === 0)) return [];
  return filled;
}

/** Per-day play counts from daily_stats for contribution calendars (~1 year). */
export async function getDailyActivity(db: Db, days = 371) {
  const rows = await db
    .select({
      day: dailyStats.day,
      playCount: dailyStats.playCount,
    })
    .from(dailyStats)
    .orderBy(desc(dailyStats.day))
    .limit(days);

  return rows
    .slice()
    .reverse()
    .map((r) => ({
      day: r.day,
      playCount: r.playCount,
    }));
}

/**
 * Play counts for the session calendar. Offset 0 reads UTC `daily_stats`.
 * Any other offset recounts recent scores onto that local calendar date.
 */
export async function getCalendarActivity(
  db: Db,
  days = 371,
  tzOffsetMinutes = 0,
) {
  if (tzOffsetMinutes === 0) return getDailyActivity(db, days);
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db
    .select({ playedAt: scores.playedAt })
    .from(scores)
    .where(
      and(
        eq(scores.deletePending, false),
        gte(scores.playedAt, since),
        scoresUsernameCondition(resolveScoresUsernamesSync(db)),
        scoresGamemodeCondition(resolveScoresGamemodeSync(db)),
      ),
    );
  const counts = new Map<string, number>();
  for (const row of rows) {
    const played =
      row.playedAt instanceof Date ? row.playedAt : new Date(row.playedAt);
    const day = localDayKey(played, tzOffsetMinutes);
    counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, playCount]) => ({ day, playCount }));
}
