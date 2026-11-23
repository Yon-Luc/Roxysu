import type { Db } from "@roxysu/db/types";

import { toIso } from "../shared/serialize";
import { localDayKey } from "../shared/localDay";
import { countSessionPbs, listSessions } from "./session";
import { getCalendarActivity } from "./progression";

/** Snapshot window: today plus enough local days for a meaningful streak. */
const SNAPSHOT_DAYS = 60;

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/**
 * Consecutive local calendar days ending today. The streak is anchored at
 * today: a rest day today (or any gap before it) breaks it — it never
 * starts from the last play day.
 */
function computeActiveDayStreak(
  playCountByDay: Map<string, number>,
  todayKey: string,
): number {
  let streak = 0;
  let cursor = todayKey;
  while ((playCountByDay.get(cursor) ?? 0) > 0) {
    streak += 1;
    cursor = addDays(cursor, -1);
    if (streak > SNAPSHOT_DAYS) break;
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

/** Cheap Home snapshot from recent play counts + last closed session. */
export async function getPracticeSnapshot(
  db: Db,
  tzOffsetMinutes = 0,
): Promise<PracticeSnapshot> {
  // Snapshot days are the player's local calendar date, the same convention
  // as the Sessions activity calendar. tzOffset 0 still reads the stored
  // daily_stats; any other offset recounts recent scores onto local dates
  // via getCalendarActivity.
  const today = localDayKey(new Date(), tzOffsetMinutes);
  const activity = await getCalendarActivity(
    db,
    SNAPSHOT_DAYS,
    tzOffsetMinutes,
  );
  const playCountByDay = new Map<string, number>();
  for (const row of activity) {
    playCountByDay.set(row.day, row.playCount);
  }

  const playsToday = playCountByDay.get(today) ?? 0;
  let playsLast7Days = 0;
  for (let i = 0; i < 7; i++) {
    playsLast7Days += playCountByDay.get(addDays(today, -i)) ?? 0;
  }
  const activeDayStreak = computeActiveDayStreak(playCountByDay, today);

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
    activeDayStreak,
    lastSession,
  };
}
