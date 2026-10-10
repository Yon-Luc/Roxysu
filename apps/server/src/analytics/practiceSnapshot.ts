import type { Db } from "@roxysu/db/types";
import { dailyStats } from "@roxysu/db/schema";
import { desc } from "drizzle-orm";

import { toIso } from "../shared/serialize";
import { countSessionPbs, listSessions } from "./session";

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addUtcDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return utcDayKey(d);
}

function computeActiveDayStreak(playCountByDay: Map<string, number>): number {
  const activeDays = [...playCountByDay.entries()]
    .filter(([, n]) => n > 0)
    .map(([day]) => day)
    .sort();
  if (activeDays.length === 0) return 0;

  let cursor = activeDays[activeDays.length - 1]!;
  let streak = 0;
  while ((playCountByDay.get(cursor) ?? 0) > 0) {
    streak += 1;
    cursor = addUtcDays(cursor, -1);
  }
  return streak;
}

export type PracticeSnapshot = {
  playsToday: number;
  playsLast7Days: number;
  activeDayStreak: number;
  lastSession: {
    id: number;
    name: string;
    scoreCount: number;
    startedAt: string | null;
    endedAt: string | null;
    durationMs: number | null;
    pbCount: number;
    rulesetShortName: string | null;
  } | null;
};

/** Cheap Home snapshot from daily_stats + last closed session. */
export async function getPracticeSnapshot(db: Db): Promise<PracticeSnapshot> {
  const today = utcDayKey(new Date());
  const windowStart = addUtcDays(today, -59);

  const rows = await db
    .select({
      day: dailyStats.day,
      playCount: dailyStats.playCount,
    })
    .from(dailyStats)
    .orderBy(desc(dailyStats.day))
    .limit(60);

  const playCountByDay = new Map<string, number>();
  for (const row of rows) {
    if (row.day >= windowStart) {
      playCountByDay.set(row.day, row.playCount);
    }
  }

  const playsToday = playCountByDay.get(today) ?? 0;
  let playsLast7Days = 0;
  for (let i = 0; i < 7; i++) {
    playsLast7Days += playCountByDay.get(addUtcDays(today, -i)) ?? 0;
  }

  const sessions = await listSessions(db, 8);
  const closed = sessions.find((s) => s.endedAt != null) ?? null;
  let lastSession: PracticeSnapshot["lastSession"] = null;
  if (closed?.endedAt != null) {
    const startedMs = closed.startedAt.getTime();
    const endedMs = closed.endedAt.getTime();
    const durationMs = endedMs >= startedMs ? endedMs - startedMs : null;
    const pbCount = await countSessionPbs(db, closed.id);
    lastSession = {
      id: closed.id,
      name: closed.name,
      scoreCount: closed.scoreCount,
      startedAt: toIso(closed.startedAt),
      endedAt: toIso(closed.endedAt),
      durationMs,
      pbCount,
      rulesetShortName: closed.rulesetShortName,
    };
  }

  return {
    playsToday,
    playsLast7Days,
    activeDayStreak: computeActiveDayStreak(playCountByDay),
    lastSession,
  };
}
