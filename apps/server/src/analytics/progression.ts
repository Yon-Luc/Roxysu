import {
  desc,
  type Db,
  dailyStats,
  weeklyStats,
} from "@roxysu/db/client.bun";

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

export async function getWeeklyActivity(db: Db, weeks = 12) {
  const rows = await db
    .select()
    .from(weeklyStats)
    .orderBy(desc(weeklyStats.weekStart))
    .limit(weeks);

  return rows
    .slice()
    .reverse()
    .map((r) => ({
      weekStart: r.weekStart,
      playCount: r.playCount,
      totalPp: r.totalPp,
      avgAccuracy: r.avgAccuracy,
    }));
}
