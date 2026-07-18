import {
  and,
  eq,
  isNotNull,
  type Db,
  scores,
  beatmaps,
  dailyStats,
  weeklyStats,
  mapperStats,
} from "@roxysu/db/client.bun";

function toMs(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday-start ISO week key YYYY-MM-DD of week start. */
function weekStartKey(d: Date): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = copy.getUTCDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy.toISOString().slice(0, 10);
}

export async function runStatisticsEngine(db: Db): Promise<void> {
  const rows = await db
    .select({
      accuracy: scores.accuracy,
      pp: scores.pp,
      playedAt: scores.playedAt,
      mapperOnlineId: beatmaps.mapperOnlineId,
      mapperUsername: beatmaps.mapperUsername,
    })
    .from(scores)
    .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .where(and(eq(scores.deletePending, false), isNotNull(scores.beatmapId)));

  type Bucket = {
    playCount: number;
    totalPp: number;
    accSum: number;
  };

  const daily = new Map<string, Bucket>();
  const weekly = new Map<string, Bucket>();
  const mappers = new Map<
    number,
    Bucket & { mapperUsername: string | null }
  >();

  for (const row of rows) {
    const played = new Date(toMs(row.playedAt));
    const dKey = dayKey(played);
    const wKey = weekStartKey(played);
    const pp = row.pp ?? 0;

    const bump = (map: Map<string, Bucket>, key: string) => {
      const b = map.get(key) ?? { playCount: 0, totalPp: 0, accSum: 0 };
      b.playCount += 1;
      b.totalPp += pp;
      b.accSum += row.accuracy;
      map.set(key, b);
    };
    bump(daily, dKey);
    bump(weekly, wKey);

    if (row.mapperOnlineId != null) {
      const m =
        mappers.get(row.mapperOnlineId) ?? {
          playCount: 0,
          totalPp: 0,
          accSum: 0,
          mapperUsername: row.mapperUsername,
        };
      m.playCount += 1;
      m.totalPp += pp;
      m.accSum += row.accuracy;
      m.mapperUsername = row.mapperUsername ?? m.mapperUsername;
      mappers.set(row.mapperOnlineId, m);
    }
  }

  await db.delete(dailyStats);
  await db.delete(weeklyStats);
  await db.delete(mapperStats);

  const dailyRows = [...daily.entries()].map(([day, b]) => ({
    day,
    playCount: b.playCount,
    totalPp: b.totalPp,
    avgAccuracy: b.playCount > 0 ? b.accSum / b.playCount : null,
  }));
  const weeklyRows = [...weekly.entries()].map(([weekStart, b]) => ({
    weekStart,
    playCount: b.playCount,
    totalPp: b.totalPp,
    avgAccuracy: b.playCount > 0 ? b.accSum / b.playCount : null,
  }));
  const mapperRows = [...mappers.entries()].map(([mapperOnlineId, b]) => ({
    mapperOnlineId,
    mapperUsername: b.mapperUsername,
    playCount: b.playCount,
    totalPp: b.totalPp,
    avgAccuracy: b.playCount > 0 ? b.accSum / b.playCount : null,
  }));

  const BATCH = 500;
  for (let i = 0; i < dailyRows.length; i += BATCH) {
    const batch = dailyRows.slice(i, i + BATCH);
    if (batch.length) await db.insert(dailyStats).values(batch);
  }
  for (let i = 0; i < weeklyRows.length; i += BATCH) {
    const batch = weeklyRows.slice(i, i + BATCH);
    if (batch.length) await db.insert(weeklyStats).values(batch);
  }
  for (let i = 0; i < mapperRows.length; i += BATCH) {
    const batch = mapperRows.slice(i, i + BATCH);
    if (batch.length) await db.insert(mapperStats).values(batch);
  }
}
