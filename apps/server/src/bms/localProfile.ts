import {
  beatmapSets,
  beatmaps,
  bmsScoreDetails,
  bmsTableCache,
  scores,
  sessions,
} from "@roxysu/db/schema";
import {
  comboLampMeets,
  gradeMeets,
  loadRecentBmsSessions,
  type BmsDjGrade,
} from "@roxysu/db/bms";
import { loadBundledBmsTables } from "@roxysu/db/bms-tables";
import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";
import type { Db } from "@roxysu/db/types";
import {
  resolveScoresUsernames,
  scoresUsernameCondition,
} from "../analytics/scoreUsername";

function playedMs(value: Date | number): number {
  return value instanceof Date ? value.getTime() : value;
}

function baseFilters(usernames: string[] | null, variant: string | null) {
  const filters = [
    eq(scores.deletePending, false),
    eq(scores.rulesetShortName, "bms"),
    eq(bmsScoreDetails.autoplay, false),
  ];
  const user = scoresUsernameCondition(usernames);
  if (user) filters.push(user);
  if (variant) filters.push(eq(bmsScoreDetails.variantId, variant));
  return and(...filters);
}

export async function localBmsOverview(db: Db, variant: string | null) {
  const usernames = await resolveScoresUsernames(db);
  const where = baseFilters(usernames, null);
  const variantRows = await db
    .select({
      variantId: bmsScoreDetails.variantId,
      plays: sql<number>`count(*)`.mapWith(Number),
    })
    .from(bmsScoreDetails)
    .innerJoin(scores, eq(scores.id, bmsScoreDetails.scoreId))
    .where(where)
    .groupBy(bmsScoreDetails.variantId)
    .orderBy(desc(sql`count(*)`));

  const selected = variant ?? variantRows[0]?.variantId ?? null;
  const filtered = baseFilters(usernames, selected);
  const [summary] = await db
    .select({
      plays: sql<number>`count(*)`.mapWith(Number),
      latest: sql<number | null>`max(${scores.playedAt})`.mapWith((value) =>
        value == null ? null : Number(value),
      ),
    })
    .from(bmsScoreDetails)
    .innerJoin(scores, eq(scores.id, bmsScoreDetails.scoreId))
    .where(filtered);

  const recent = await listLocalScores(db, {
    variant: selected,
    limit: 8,
  });

  return {
    username: usernames?.length === 1 ? usernames[0] : null,
    usernames,
    variantId: selected,
    variants: variantRows,
    plays: summary?.plays ?? 0,
    latestPlayedAt: summary?.latest ?? null,
    recent: recent.scores,
  };
}

export async function listLocalScores(
  db: Db,
  input: { variant: string | null; limit: number; cursor?: string | null },
) {
  const usernames = await resolveScoresUsernames(db);
  const filters = [baseFilters(usernames, input.variant)!];
  if (input.cursor) {
    const [msRaw, id] = input.cursor.split("|");
    const ms = Number(msRaw);
    if (Number.isFinite(ms) && id) {
      filters.push(
        or(
          lt(scores.playedAt, new Date(ms)),
          and(eq(scores.playedAt, new Date(ms)), lt(scores.id, id)),
        )!,
      );
    }
  }
  const limit = Math.min(50, Math.max(1, input.limit));
  const rows = await db
    .select({
      id: scores.id,
      playedAt: scores.playedAt,
      beatmapId: beatmaps.id,
      title: beatmaps.title,
      artist: beatmaps.artist,
      difficulty: beatmaps.difficultyName,
      md5: beatmaps.md5Hash,
      backgroundFileHash: beatmaps.backgroundFileHash,
      setOnlineId: beatmapSets.onlineId,
      exScore: bmsScoreDetails.exScore,
      maxExScore: bmsScoreDetails.maxExScore,
      normalizedScore: bmsScoreDetails.normalizedScore,
      accuracy: bmsScoreDetails.accuracy,
      pgreat: bmsScoreDetails.pgreat,
      great: bmsScoreDetails.great,
      good: bmsScoreDetails.good,
      bad: bmsScoreDetails.bad,
      poor: bmsScoreDetails.poor,
      miss: bmsScoreDetails.miss,
      variantId: bmsScoreDetails.variantId,
      gaugeId: bmsScoreDetails.gaugeId,
      comboLampId: bmsScoreDetails.comboLampId,
      clearLampId: bmsScoreDetails.clearLampId,
      djGrade: bmsScoreDetails.djGrade,
    })
    .from(bmsScoreDetails)
    .innerJoin(scores, eq(scores.id, bmsScoreDetails.scoreId))
    .leftJoin(beatmaps, eq(beatmaps.id, scores.beatmapId))
    .leftJoin(beatmapSets, eq(beatmapSets.id, beatmaps.setId))
    .where(and(...filters))
    .orderBy(desc(scores.playedAt), desc(scores.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor =
    rows.length > limit && last
      ? `${playedMs(last.playedAt)}|${last.id}`
      : null;
  return {
    scores: page.map((row) => ({
      ...row,
      playedAt: playedMs(row.playedAt),
    })),
    nextCursor,
  };
}

export async function listLocalSessions(db: Db, variant: string | null) {
  const usernames = await resolveScoresUsernames(db);
  const grouped = await loadRecentBmsSessions(async (offset, limit) => {
    const rows = await db
      .select({
        id: scores.id,
        playedAt: scores.playedAt,
        exScore: bmsScoreDetails.exScore,
        normalizedScore: bmsScoreDetails.normalizedScore,
        title: beatmaps.title,
      })
      .from(bmsScoreDetails)
      .innerJoin(scores, eq(scores.id, bmsScoreDetails.scoreId))
      .leftJoin(beatmaps, eq(beatmaps.id, scores.beatmapId))
      .where(baseFilters(usernames, variant))
      .orderBy(desc(scores.playedAt), desc(scores.id))
      .limit(limit)
      .offset(offset);
    return rows.map((row) => ({ ...row, playedAt: playedMs(row.playedAt) }));
  });
  const stored = await db
    .select({
      id: sessions.id,
      name: sessions.name,
      startedAt: sessions.startedAt,
      endedAt: sessions.endedAt,
      scoreCount: sessions.scoreCount,
    })
    .from(sessions)
    .where(eq(sessions.rulesetShortName, "bms"))
    .orderBy(desc(sessions.startedAt))
    .limit(20);

  return {
    sessions: grouped.map((session) => ({
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      scoreCount: session.scoreCount,
      titles: session.scores
        .map((score) => score.title)
        .filter((title): title is string => !!title)
        .slice(0, 3),
    })),
    stored,
  };
}

type CacheEntry = {
  level: string;
  levelIndex: number;
  md5: string | null;
  sha256: string | null;
  title?: string | null;
  artist?: string | null;
};

let bundledTablesSeeded = false;

/** Insane, Satellite, and Stella ship with the app, so the song list works offline. */
export async function seedBundledLocalTables(db: Db): Promise<void> {
  if (bundledTablesSeeded) return;
  const now = Date.now();
  for (const table of loadBundledBmsTables()) {
    await replaceTableCache(db, {
      versionId: table.versionId,
      tableId: table.tableId,
      name: table.parsed.name,
      symbol: table.parsed.symbol,
      sourceUrl: table.sourceUrl,
      importedAt: now,
      levelOrder: table.parsed.levelOrder,
      entries: table.parsed.entries.map((entry) => ({
        level: entry.level,
        levelIndex: entry.levelIndex,
        md5: entry.md5,
        sha256: entry.sha256,
        title: entry.title,
        artist: entry.artist,
      })),
      unresolvedCount: table.parsed.unresolvedCount,
    });
  }
  bundledTablesSeeded = true;
}

function achievementHit(
  row: { djGrade: string | null; comboLampId: string | null },
  achievement: string,
): boolean {
  if (achievement === "fc" || achievement === "perfect" || achievement === "max-lamp") {
    const minimum = achievement === "max-lamp" ? "max" : achievement;
    return comboLampMeets(row.comboLampId, minimum);
  }
  return gradeMeets(row.djGrade, achievement as BmsDjGrade);
}

export async function localTableCompletion(
  db: Db,
  variant: string,
  achievement: string,
) {
  const usernames = await resolveScoresUsernames(db);
  const versions = await db
    .select()
    .from(bmsTableCache)
    .orderBy(desc(bmsTableCache.importedAt));
  const latest = new Map<string, (typeof versions)[number]>();
  for (const version of versions) {
    if (!latest.has(version.tableId)) latest.set(version.tableId, version);
  }

  const played = await db
    .select({
      md5: beatmaps.md5Hash,
      sha256: beatmaps.hash,
      djGrade: bmsScoreDetails.djGrade,
      comboLampId: bmsScoreDetails.comboLampId,
    })
    .from(bmsScoreDetails)
    .innerJoin(scores, eq(scores.id, bmsScoreDetails.scoreId))
    .innerJoin(beatmaps, eq(beatmaps.id, scores.beatmapId))
    .where(baseFilters(usernames, variant));

  const hits = new Set<string>();
  for (const row of played) {
    if (!achievementHit(row, achievement)) continue;
    if (row.md5) hits.add(row.md5.toLowerCase());
    if (row.sha256) hits.add(row.sha256.toLowerCase());
  }

  return [...latest.values()].map((version) => {
    const entries = JSON.parse(version.entriesJson) as CacheEntry[];
    const levels = new Map<
      string,
      {
        level: string;
        index: number;
        total: number;
        cleared: number;
        songs: Array<{ title: string | null; artist: string | null; md5: string | null; cleared: boolean }>;
      }
    >();
    for (const entry of entries) {
      const bucket = levels.get(entry.level) ?? {
        level: entry.level,
        index: entry.levelIndex,
        total: 0,
        cleared: 0,
        songs: [],
      };
      const cleared = [entry.md5, entry.sha256].some(
        (hash) => !!hash && hits.has(hash.toLowerCase()),
      );
      bucket.total += 1;
      if (cleared) bucket.cleared += 1;
      bucket.songs.push({
        title: entry.title ?? null,
        artist: entry.artist ?? null,
        md5: entry.md5,
        cleared,
      });
      levels.set(entry.level, bucket);
    }
    return {
      tableId: version.tableId,
      versionId: version.versionId,
      name: version.name,
      symbol: version.symbol,
      unresolvedCount: version.unresolvedCount,
      levels: [...levels.values()]
        .sort((a, b) => a.index - b.index || a.level.localeCompare(b.level))
        .map((level) => ({
          ...level,
          songs: level.songs.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "")),
        })),
    };
  });
}

export async function listCachedTables(db: Db) {
  const rows = await db
    .select({
      tableId: bmsTableCache.tableId,
      versionId: bmsTableCache.versionId,
      name: bmsTableCache.name,
      symbol: bmsTableCache.symbol,
      importedAt: bmsTableCache.importedAt,
    })
    .from(bmsTableCache)
    .orderBy(asc(bmsTableCache.name));
  return rows;
}

export async function replaceTableCache(
  db: Db,
  version: {
    versionId: string;
    tableId: string;
    name: string;
    symbol: string;
    sourceUrl: string;
    importedAt: number;
    levelOrder: string[];
    entries: Array<CacheEntry & { title?: string | null; artist?: string | null }>;
    unresolvedCount: number;
  },
) {
  await db
    .insert(bmsTableCache)
    .values({
      versionId: version.versionId,
      tableId: version.tableId,
      name: version.name,
      symbol: version.symbol,
      sourceUrl: version.sourceUrl,
      importedAt: new Date(version.importedAt),
      levelOrderJson: JSON.stringify(version.levelOrder),
      entriesJson: JSON.stringify(version.entries),
      unresolvedCount: version.unresolvedCount,
    })
    .onConflictDoNothing();
}
