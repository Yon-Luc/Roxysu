import type { Db } from "@roxysu/db/types";
import { beatmaps, dailyStats, mapperStats, scores, weeklyStats } from "@roxysu/db/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { isNomodOrMirrorOnly } from "../replay/mods";
import {
  loadManiaPpCurves,
  resolveScorePp,
  type ManiaPpCurve,
} from "../mania-rating/estimateScorePp";
import {
  resolveScoresGamemode,
  scoresGamemodeCondition,
} from "./scoreGamemode";
import {
  resolveScoresUsernames,
  scoresUsernameCondition,
} from "./scoreUsername";

function toMs(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monday-start ISO week key YYYY-MM-DD of week start. */
function weekStartKey(d: Date): string {
  const copy = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const day = copy.getUTCDay(); // 0 Sun
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy.toISOString().slice(0, 10);
}

type Bucket = {
  playCount: number;
  totalPp: number;
  accSum: number;
};

function bump(map: Map<string, Bucket>, key: string, accuracy: number, pp: number) {
  const b = map.get(key) ?? { playCount: 0, totalPp: 0, accSum: 0 };
  b.playCount += 1;
  b.totalPp += pp;
  b.accSum += accuracy;
  map.set(key, b);
}

function effectivePp(
  row: {
    pp: number | null;
    accuracy: number;
    mods: string | null;
    rulesetShortName: string | null;
    beatmapId: string | null;
  },
  curves: Map<string, ManiaPpCurve>,
): number {
  return (
    resolveScorePp({
      pp: row.pp,
      accuracy: row.accuracy,
      mods: row.mods,
      rulesetShortName: row.rulesetShortName,
      curve: row.beatmapId ? curves.get(row.beatmapId) : undefined,
    }) ?? 0
  );
}

export type StatisticsEngineOptions = {
  /** Rebuild only days/weeks/mappers touched by these scores. */
  scoreIds?: string[];
  /** Rebuild only these mapper partitions (map-metadata changes). */
  mapperOnlineIds?: number[];
};

export async function runStatisticsEngine(
  db: Db,
  options?: StatisticsEngineOptions,
): Promise<void> {
  const scoreIds = options?.scoreIds;
  const mapperOnly = options?.mapperOnlineIds;

  // Mapper-only refresh (no score timeline change).
  if (mapperOnly && mapperOnly.length > 0 && !scoreIds) {
    await rebuildMapperPartitions(db, mapperOnly);
    return;
  }

  if (scoreIds && scoreIds.length > 0) {
    await rebuildPartitionsForScores(db, scoreIds);
    return;
  }

  // Full rebuild
  const [usernames, gamemode] = await Promise.all([
    resolveScoresUsernames(db),
    resolveScoresGamemode(db),
  ]);
  const usernameCond = scoresUsernameCondition(usernames);
  const gamemodeCond = scoresGamemodeCondition(gamemode);
  const rows = await db
    .select({
      accuracy: scores.accuracy,
      pp: scores.pp,
      playedAt: scores.playedAt,
      mods: scores.mods,
      beatmapId: scores.beatmapId,
      rulesetShortName: scores.rulesetShortName,
      mapperOnlineId: beatmaps.mapperOnlineId,
      mapperUsername: beatmaps.mapperUsername,
    })
    .from(scores)
    .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .where(
      and(
        eq(scores.deletePending, false),
        isNotNull(scores.beatmapId),
        usernameCond,
        gamemodeCond,
      ),
    );

  const curves = await loadManiaPpCurves(db);
  const daily = new Map<string, Bucket>();
  const weekly = new Map<string, Bucket>();
  const mappers = new Map<number, Bucket & { mapperUsername: string | null }>();

  for (const row of rows) {
    if (!isNomodOrMirrorOnly(row.mods)) continue;
    const played = new Date(toMs(row.playedAt));
    const pp = effectivePp(row, curves);
    bump(daily, dayKey(played), row.accuracy, pp);
    bump(weekly, weekStartKey(played), row.accuracy, pp);

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

  await insertStatPartitions(db, daily, weekly, mappers);
}

async function rebuildPartitionsForScores(db: Db, scoreIds: string[]) {
  const touched = await db
    .select({
      playedAt: scores.playedAt,
      mapperOnlineId: beatmaps.mapperOnlineId,
    })
    .from(scores)
    .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .where(inArray(scores.id, scoreIds));

  const dayKeys = new Set<string>();
  const weekKeys = new Set<string>();
  const mapperIds = new Set<number>();
  for (const row of touched) {
    const played = new Date(toMs(row.playedAt));
    dayKeys.add(dayKey(played));
    weekKeys.add(weekStartKey(played));
    if (row.mapperOnlineId != null) mapperIds.add(row.mapperOnlineId);
  }

  if (dayKeys.size === 0 && weekKeys.size === 0 && mapperIds.size === 0) return;

  // Re-aggregate from all non-deleted scores that fall in the touched partitions.
  const [usernames, gamemode] = await Promise.all([
    resolveScoresUsernames(db),
    resolveScoresGamemode(db),
  ]);
  const all = await db
    .select({
      accuracy: scores.accuracy,
      pp: scores.pp,
      playedAt: scores.playedAt,
      mods: scores.mods,
      beatmapId: scores.beatmapId,
      rulesetShortName: scores.rulesetShortName,
      mapperOnlineId: beatmaps.mapperOnlineId,
      mapperUsername: beatmaps.mapperUsername,
    })
    .from(scores)
    .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .where(
      and(
        eq(scores.deletePending, false),
        isNotNull(scores.beatmapId),
        scoresUsernameCondition(usernames),
        scoresGamemodeCondition(gamemode),
      ),
    );

  const curves = await loadManiaPpCurves(db);
  const daily = new Map<string, Bucket>();
  const weekly = new Map<string, Bucket>();
  const mappers = new Map<number, Bucket & { mapperUsername: string | null }>();

  for (const row of all) {
    if (!isNomodOrMirrorOnly(row.mods)) continue;
    const played = new Date(toMs(row.playedAt));
    const dKey = dayKey(played);
    const wKey = weekStartKey(played);
    const pp = effectivePp(row, curves);

    if (dayKeys.has(dKey)) bump(daily, dKey, row.accuracy, pp);
    if (weekKeys.has(wKey)) bump(weekly, wKey, row.accuracy, pp);

    if (row.mapperOnlineId != null && mapperIds.has(row.mapperOnlineId)) {
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

  const days = [...dayKeys];
  const weeks = [...weekKeys];
  const mids = [...mapperIds];
  if (days.length) await db.delete(dailyStats).where(inArray(dailyStats.day, days));
  if (weeks.length)
    await db.delete(weeklyStats).where(inArray(weeklyStats.weekStart, weeks));
  if (mids.length)
    await db.delete(mapperStats).where(inArray(mapperStats.mapperOnlineId, mids));

  await insertStatPartitions(db, daily, weekly, mappers);
}

async function rebuildMapperPartitions(db: Db, mapperOnlineIds: number[]) {
  const [usernames, gamemode] = await Promise.all([
    resolveScoresUsernames(db),
    resolveScoresGamemode(db),
  ]);
  const all = await db
    .select({
      accuracy: scores.accuracy,
      pp: scores.pp,
      mods: scores.mods,
      beatmapId: scores.beatmapId,
      rulesetShortName: scores.rulesetShortName,
      mapperOnlineId: beatmaps.mapperOnlineId,
      mapperUsername: beatmaps.mapperUsername,
    })
    .from(scores)
    .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
    .where(
      and(
        eq(scores.deletePending, false),
        isNotNull(scores.beatmapId),
        inArray(beatmaps.mapperOnlineId, mapperOnlineIds),
        scoresUsernameCondition(usernames),
        scoresGamemodeCondition(gamemode),
      ),
    );

  const curves = await loadManiaPpCurves(db);
  const mappers = new Map<number, Bucket & { mapperUsername: string | null }>();
  for (const row of all) {
    if (row.mapperOnlineId == null) continue;
    if (!isNomodOrMirrorOnly(row.mods)) continue;
    const m =
      mappers.get(row.mapperOnlineId) ?? {
        playCount: 0,
        totalPp: 0,
        accSum: 0,
        mapperUsername: row.mapperUsername,
      };
    m.playCount += 1;
    m.totalPp += effectivePp(row, curves);
    m.accSum += row.accuracy;
    m.mapperUsername = row.mapperUsername ?? m.mapperUsername;
    mappers.set(row.mapperOnlineId, m);
  }

  await db
    .delete(mapperStats)
    .where(inArray(mapperStats.mapperOnlineId, mapperOnlineIds));

  await insertStatPartitions(db, new Map(), new Map(), mappers);
}

async function insertStatPartitions(
  db: Db,
  daily: Map<string, Bucket>,
  weekly: Map<string, Bucket>,
  mappers: Map<number, Bucket & { mapperUsername: string | null }>,
) {
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
