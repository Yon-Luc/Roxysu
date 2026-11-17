import type { Db } from "@roxysu/db/types";
import { dailyStats, weeklyStats } from "@roxysu/db/schema";
import { desc, gte } from "drizzle-orm";

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

/** Last `weeks` UTC calendar weeks, including weeks with no plays. */
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
