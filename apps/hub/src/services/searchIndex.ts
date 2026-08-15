import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import { searchCache, searchIndexDiffs, searchIndexSets } from "@roxysu/db/hub";
import { db } from "../db";
import type { HubSearchStub, SearchSecondaryFilters } from "./cache";

const INSERT_CHUNK = 200;
export const SEARCH_ALL_MAX_SETS = 100_000;

export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

type QueryDb =
  | typeof db
  | Parameters<Parameters<typeof db.transaction>[0]>[0];

function secondaryWhere(cacheId: number, secondary: SearchSecondaryFilters) {
  const q = secondary.query?.trim();
  const creator = secondary.creator?.trim();
  const hasStar = secondary.min_stars != null || secondary.max_stars != null;
  const hasBpm = secondary.min_bpm != null || secondary.max_bpm != null;
  const hasLength = secondary.min_length != null || secondary.max_length != null;

  const parts = [eq(searchIndexSets.cacheId, cacheId)];

  if (q) {
    const pat = `%${escapeLikePattern(q.toLowerCase())}%`;
    parts.push(
      sql`LOWER(${searchIndexSets.artist} || ' ' || ${searchIndexSets.title}) LIKE ${pat} ESCAPE '\\'`,
    );
  }
  if (creator) {
    const pat = `%${escapeLikePattern(creator.toLowerCase())}%`;
    parts.push(sql`LOWER(${searchIndexSets.creator}) LIKE ${pat} ESCAPE '\\'`);
  }
  if (hasBpm) {
    parts.push(sql`${searchIndexSets.bpm} IS NOT NULL`);
    if (secondary.min_bpm != null) {
      parts.push(sql`${searchIndexSets.bpm} >= ${secondary.min_bpm}`);
    }
    if (secondary.max_bpm != null) {
      parts.push(sql`${searchIndexSets.bpm} <= ${secondary.max_bpm}`);
    }
  }
  if (hasLength) {
    parts.push(sql`${searchIndexSets.lengthSeconds} IS NOT NULL`);
    if (secondary.min_length != null) {
      parts.push(sql`${searchIndexSets.lengthSeconds} >= ${secondary.min_length}`);
    }
    if (secondary.max_length != null) {
      parts.push(sql`${searchIndexSets.lengthSeconds} <= ${secondary.max_length}`);
    }
  }
  if (hasStar) {
    const starParts = [sql`d.set_row_id = ${searchIndexSets.id}`];
    if (secondary.min_stars != null) {
      starParts.push(sql`d.stars >= ${secondary.min_stars}`);
    }
    if (secondary.max_stars != null) {
      starParts.push(sql`d.stars <= ${secondary.max_stars}`);
    }
    parts.push(
      sql`EXISTS (SELECT 1 FROM search_index_diffs d WHERE ${sql.join(starParts, sql` AND `)})`,
    );
  }

  return and(...parts);
}

function setRowToStub(
  row: typeof searchIndexSets.$inferSelect,
  diffs: Array<typeof searchIndexDiffs.$inferSelect>,
): HubSearchStub {
  return {
    id: row.beatmapsetId,
    artist: row.artist,
    title: row.title,
    creator: row.creator,
    status: row.status,
    bpm: row.bpm,
    favouriteCount: row.favouriteCount,
    playCount: row.playCount,
    hasVideo: row.hasVideo,
    rankedDate: row.rankedDate,
    lengthSeconds: row.lengthSeconds,
    beatmaps: diffs.map((d) => ({
      id: d.beatmapId,
      version: d.version,
      stars: d.stars,
      mode: d.mode,
      modeInt: d.modeInt,
      keys: d.keys,
      totalLength: d.totalLength,
    })),
  };
}

async function loadDiffsBySetRowId(
  database: QueryDb,
  setRowIds: number[],
): Promise<Map<number, Array<typeof searchIndexDiffs.$inferSelect>>> {
  const bySet = new Map<number, Array<typeof searchIndexDiffs.$inferSelect>>();
  if (setRowIds.length === 0) return bySet;
  const rows = await database
    .select()
    .from(searchIndexDiffs)
    .where(inArray(searchIndexDiffs.setRowId, setRowIds));
  for (const row of rows) {
    const list = bySet.get(row.setRowId);
    if (list) list.push(row);
    else bySet.set(row.setRowId, [row]);
  }
  return bySet;
}

export async function countSearchIndexSets(
  database: QueryDb,
  cacheId: number,
  secondary: SearchSecondaryFilters,
): Promise<number> {
  const row = await database
    .select({ n: count() })
    .from(searchIndexSets)
    .where(secondaryWhere(cacheId, secondary))
    .get();
  return row?.n ?? 0;
}

export async function querySearchIndexPage(
  database: QueryDb,
  cacheId: number,
  secondary: SearchSecondaryFilters,
  page: number,
  limit: number,
): Promise<{ stubs: HubSearchStub[]; ids: number[]; total: number }> {
  const total = await countSearchIndexSets(database, cacheId, secondary);
  const offset = Math.max(0, page) * limit;
  const rows = await database
    .select()
    .from(searchIndexSets)
    .where(secondaryWhere(cacheId, secondary))
    .orderBy(asc(searchIndexSets.position))
    .limit(limit)
    .offset(offset);
  const diffs = await loadDiffsBySetRowId(
    database,
    rows.map((r) => r.id),
  );
  const stubs = rows.map((row) => setRowToStub(row, diffs.get(row.id) ?? []));
  return {
    stubs,
    ids: stubs.map((s) => s.id),
    total,
  };
}

export type SearchIndexDumpFields = "ids" | "compact" | "full";

export type SearchIndexDump = {
  total: number;
  truncated: boolean;
  beatmapsetIds: number[];
  sets: Array<{ id: number; artist: string; title: string }>;
  stubs: HubSearchStub[];
};

export async function querySearchIndexAll(
  database: QueryDb,
  cacheId: number,
  secondary: SearchSecondaryFilters,
  opts?: { fields?: SearchIndexDumpFields; maxSets?: number },
): Promise<SearchIndexDump> {
  const fields = opts?.fields ?? "compact";
  const maxSets = Math.min(
    SEARCH_ALL_MAX_SETS,
    Math.max(1, opts?.maxSets ?? SEARCH_ALL_MAX_SETS),
  );
  const total = await countSearchIndexSets(database, cacheId, secondary);
  const rows = await database
    .select()
    .from(searchIndexSets)
    .where(secondaryWhere(cacheId, secondary))
    .orderBy(asc(searchIndexSets.position))
    .limit(maxSets);

  const beatmapsetIds = rows.map((r) => r.beatmapsetId);
  const sets = rows.map((r) => ({
    id: r.beatmapsetId,
    artist: r.artist,
    title: r.title,
  }));

  if (fields !== "full") {
    return {
      total,
      truncated: total > rows.length,
      beatmapsetIds,
      sets,
      stubs: [],
    };
  }

  const diffs = await loadDiffsBySetRowId(
    database,
    rows.map((r) => r.id),
  );
  const stubs = rows.map((row) => setRowToStub(row, diffs.get(row.id) ?? []));
  return {
    total,
    truncated: total > rows.length,
    beatmapsetIds,
    sets,
    stubs,
  };
}

export async function replaceSetsForCache(
  database: QueryDb,
  cacheId: number,
  stubs: HubSearchStub[],
): Promise<void> {
  await database.delete(searchIndexSets).where(eq(searchIndexSets.cacheId, cacheId));

  for (let i = 0; i < stubs.length; i += INSERT_CHUNK) {
    const chunk = stubs.slice(i, i + INSERT_CHUNK);
    const inserted = await database
      .insert(searchIndexSets)
      .values(
        chunk.map((stub, offset) => ({
          cacheId,
          beatmapsetId: stub.id,
          artist: stub.artist,
          title: stub.title,
          creator: stub.creator,
          status: stub.status,
          bpm: stub.bpm,
          favouriteCount: stub.favouriteCount,
          playCount: stub.playCount,
          hasVideo: stub.hasVideo,
          rankedDate: stub.rankedDate,
          lengthSeconds: stub.lengthSeconds,
          position: i + offset,
        })),
      )
      .returning({
        id: searchIndexSets.id,
        beatmapsetId: searchIndexSets.beatmapsetId,
      });

    const idBySet = new Map(inserted.map((row) => [row.beatmapsetId, row.id]));
    const diffs: Array<typeof searchIndexDiffs.$inferInsert> = [];
    for (const stub of chunk) {
      const setRowId = idBySet.get(stub.id);
      if (setRowId == null) continue;
      for (const d of stub.beatmaps) {
        diffs.push({
          setRowId,
          beatmapId: d.id,
          version: d.version,
          stars: d.stars,
          mode: d.mode,
          modeInt: d.modeInt,
          keys: d.keys,
          totalLength: d.totalLength,
        });
      }
    }
    if (diffs.length > 0) {
      await database.insert(searchIndexDiffs).values(diffs);
    }
  }
}

export async function cacheHasIndexRows(
  database: QueryDb,
  cacheId: number,
): Promise<boolean> {
  const row = await database
    .select({ id: searchIndexSets.id })
    .from(searchIndexSets)
    .where(eq(searchIndexSets.cacheId, cacheId))
    .limit(1)
    .get();
  return row != null;
}

export async function ensureSearchIndexRows(
  database: QueryDb,
  cacheId: number,
  parseStoredStubs: (raw: string) => HubSearchStub[],
): Promise<void> {
  if (await cacheHasIndexRows(database, cacheId)) return;
  const row = await database
    .select({
      beatmapsetIds: searchCache.beatmapsetIds,
    })
    .from(searchCache)
    .where(eq(searchCache.id, cacheId))
    .get();
  if (!row?.beatmapsetIds || row.beatmapsetIds === "[]") return;
  const stubs = parseStoredStubs(row.beatmapsetIds);
  if (stubs.length === 0) return;
  await replaceSetsForCache(database, cacheId, stubs);
  await database
    .update(searchCache)
    .set({ beatmapsetIds: "[]" })
    .where(eq(searchCache.id, cacheId));
}
