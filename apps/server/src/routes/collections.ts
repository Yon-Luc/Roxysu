import {
  beatmapSets,
  collections,
  hubAddedCollections,
  realmCollectionHashes,
  realmCollections,
} from "@roxysu/db/schema";
import { isManagedCollectionName } from "@roxysu/collection-sync";
import { Elysia, t } from "elysia";
import { desc, eq, inArray } from "drizzle-orm";

import { dbPlugin } from "../db-runtime";
import type { Db } from "../db-runtime";
import { toIso } from "../shared/serialize";
import { publish } from "../shared/events";
import { syncCollectionsToLazer } from "../shared/syncCollections";
import { diffAgainstLibrary } from "../mirrors";
import {
  listDistinctSetIds,
  parseQuery,
  QueryParseError,
  searchBeatmaps,
} from "../query-language";
import {
  readCachedMatchCount,
  refreshCollectionMatchCount,
} from "../shared/collectionMatchCache";
import {
  buildCollectionExportZip,
  isOszBuildError,
  oszContentDisposition,
} from "../map-analysis/exportOsz";

async function resolveSmartSetOnlineIds(
  db: Db,
  query: string,
  opts?: { limit?: number },
): Promise<{
  beatmapsetIds: number[];
  unresolvedInternalSets: number;
  total: number;
}> {
  const { setIds, total } = listDistinctSetIds(db, query, opts);
  if (setIds.length === 0) {
    return { beatmapsetIds: [], unresolvedInternalSets: 0, total };
  }

  const rows = await db
    .select({ id: beatmapSets.id, onlineId: beatmapSets.onlineId })
    .from(beatmapSets)
    .where(inArray(beatmapSets.id, setIds));

  const byId = new Map(rows.map((r) => [r.id, r.onlineId]));
  const beatmapsetIds: number[] = [];
  let unresolvedInternalSets = 0;
  for (const id of setIds) {
    const onlineId = byId.get(id);
    if (onlineId != null && onlineId > 0) beatmapsetIds.push(onlineId);
    else unresolvedInternalSets += 1;
  }
  return {
    beatmapsetIds: [...new Set(beatmapsetIds)],
    unresolvedInternalSets,
    total,
  };
}

function parseBeatmapsetIdsJson(raw: string): number[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (id): id is number =>
            typeof id === "number" && Number.isSafeInteger(id) && id > 0,
        ),
      ),
    ];
  } catch {
    return [];
  }
}

function serializeHubAdded(row: typeof hubAddedCollections.$inferSelect) {
  const beatmapsetIds = parseBeatmapsetIdsJson(row.beatmapsetIdsJson);
  return {
    hubCollectionId: row.hubCollectionId,
    name: row.name,
    beatmapsetIds,
    mapCount: beatmapsetIds.length,
    hubUpdatedAt: toIso(row.hubUpdatedAt),
    lazerCollectionId: row.lazerCollectionId,
    lazerSyncedAt: toIso(row.lazerSyncedAt),
    addedAt: toIso(row.addedAt),
    updatedAt: toIso(row.updatedAt),
  };
}

export const collectionRoutes = new Elysia({ prefix: "/collections" })
  .use(dbPlugin)
  .get("/", async ({ db }) => {
    const rows = await db
      .select()
      .from(collections)
      .orderBy(desc(collections.updatedAt));

    const smartItems = rows.map((c) => ({
      kind: "smart" as const,
      id: c.id,
      name: c.name,
      query: c.query,
      matchCount: c.cachedMatchCount ?? null,
      lazerSyncedAt: toIso(c.lazerSyncedAt),
      createdAt: toIso(c.createdAt),
      updatedAt: toIso(c.updatedAt),
    }));

    const realmRows = await db
      .select()
      .from(realmCollections)
      .orderBy(desc(realmCollections.lastModified));

    const realmItems = realmRows.map((c) => ({
      kind: "realm" as const,
      id: c.id,
      name: c.name,
      mapCount: c.hashCount,
      resolvedSetCount: c.resolvedSetCount,
      managed: isManagedCollectionName(c.name),
      lastModified: toIso(c.lastModified),
      syncedAt: toIso(c.syncedAt),
    }));

    return { items: [...smartItems, ...realmItems] };
  })
  .get("/hub-added", async ({ db }) => {
    const rows = await db
      .select()
      .from(hubAddedCollections)
      .orderBy(desc(hubAddedCollections.updatedAt));
    return { items: rows.map(serializeHubAdded) };
  })
  .post(
    "/hub-added",
    async ({ db, body, set }) => {
      const beatmapsetIds = [
        ...new Set(
          body.beatmapsetIds.filter(
            (id) => Number.isSafeInteger(id) && id > 0,
          ),
        ),
      ];
      if (beatmapsetIds.length === 0) {
        set.status = 400;
        return { error: "beatmapsetIds is required" };
      }

      const hubUpdatedAt = new Date(body.hubUpdatedAt);
      if (Number.isNaN(hubUpdatedAt.getTime())) {
        set.status = 400;
        return { error: "Invalid hubUpdatedAt" };
      }

      const now = new Date();
      await db
        .insert(hubAddedCollections)
        .values({
          hubCollectionId: body.hubCollectionId,
          name: body.name.trim(),
          beatmapsetIdsJson: JSON.stringify(beatmapsetIds),
          hubUpdatedAt,
          addedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: hubAddedCollections.hubCollectionId,
          set: {
            name: body.name.trim(),
            beatmapsetIdsJson: JSON.stringify(beatmapsetIds),
            hubUpdatedAt,
            updatedAt: now,
          },
        });

      const ownership = await diffAgainstLibrary(db, beatmapsetIds);

      let sync:
        | Awaited<ReturnType<typeof syncCollectionsToLazer>>
        | undefined;
      if (body.syncLazer !== false) {
        sync = await syncCollectionsToLazer(db);
        if (!sync.ok) {
          if (sync.error.code === "locked") set.status = 423;
          else if (sync.error.code === "schema_mismatch") set.status = 409;
          else set.status = 500;
          return {
            error: sync.error.error,
            code: sync.error.code,
            ownership,
          };
        }
        publish({ type: "collection.updated" });
      }

      const [row] = await db
        .select()
        .from(hubAddedCollections)
        .where(eq(hubAddedCollections.hubCollectionId, body.hubCollectionId))
        .limit(1);

      return {
        item: row ? serializeHubAdded(row) : null,
        ownership: {
          owned: ownership.owned,
          missing: ownership.missing,
          ownedCount: ownership.owned.length,
          missingCount: ownership.missing.length,
          total: ownership.owned.length + ownership.missing.length,
        },
        sync: sync?.ok ? sync.result : null,
      };
    },
    {
      body: t.Object({
        hubCollectionId: t.Number(),
        name: t.String({ minLength: 1, maxLength: 100 }),
        beatmapsetIds: t.Array(t.Number(), { minItems: 1 }),
        hubUpdatedAt: t.String(),
        syncLazer: t.Optional(t.Boolean()),
      }),
    },
  )
  .delete(
    "/hub-added/:hubCollectionId",
    async ({ db, params, set }) => {
      const id = Number(params.hubCollectionId);
      const [existing] = await db
        .select()
        .from(hubAddedCollections)
        .where(eq(hubAddedCollections.hubCollectionId, id))
        .limit(1);
      if (!existing) {
        set.status = 404;
        return { error: "Hub-added collection not found" };
      }
      await db
        .delete(hubAddedCollections)
        .where(eq(hubAddedCollections.hubCollectionId, id));
      // Re-sync so the managed lazer collection is removed.
      const outcome = await syncCollectionsToLazer(db);
      if (!outcome.ok) {
        if (outcome.error.code === "locked") set.status = 423;
        else if (outcome.error.code === "schema_mismatch") set.status = 409;
        else set.status = 500;
        return { error: outcome.error.error, code: outcome.error.code };
      }
      publish({ type: "collection.updated" });
      return { ok: true, sync: outcome.result };
    },
    { params: t.Object({ hubCollectionId: t.String() }) },
  )
  .get(
    "/realm/:id/set-ids",
    async ({ db, params, query, set }) => {
      const [col] = await db
        .select()
        .from(realmCollections)
        .where(eq(realmCollections.id, params.id))
        .limit(1);
      if (!col) {
        set.status = 404;
        return { error: "Realm collection not found" };
      }

      const rows = await db
        .select({
          onlineId: realmCollectionHashes.beatmapsetOnlineId,
        })
        .from(realmCollectionHashes)
        .where(eq(realmCollectionHashes.collectionId, params.id));

      const beatmapsetIds = [
        ...new Set(
          rows
            .map((r) => r.onlineId)
            .filter((id): id is number => id != null && id > 0),
        ),
      ];
      const total = beatmapsetIds.length;
      const limit =
        query.limit != null && Number.isFinite(query.limit) && query.limit > 0
          ? Math.floor(query.limit)
          : null;

      return {
        kind: "realm" as const,
        id: col.id,
        name: col.name,
        beatmapsetIds: limit != null ? beatmapsetIds.slice(0, limit) : beatmapsetIds,
        hashCount: col.hashCount,
        resolvedSetCount: beatmapsetIds.length,
        unresolvedHashCount: Math.max(0, col.hashCount - beatmapsetIds.length),
        total,
      };
    },
    {
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      query: t.Object({
        limit: t.Optional(t.Numeric()),
      }),
    },
  )
  .post("/sync-lazer", async ({ db, set }) => {
    const outcome = await syncCollectionsToLazer(db);
    if (!outcome.ok) {
      if (outcome.error.code === "locked") set.status = 423;
      else if (outcome.error.code === "schema_mismatch") set.status = 409;
      else set.status = 500;
      return { error: outcome.error.error, code: outcome.error.code };
    }
    publish({ type: "collection.updated" });
    return outcome.result;
  })
  .post(
    "/",
    async ({ db, body, set }) => {
      try {
        parseQuery(body.query);
      } catch (err) {
        if (err instanceof QueryParseError) {
          set.status = 400;
          return { error: err.message };
        }
        throw err;
      }

      const [row] = await db
        .insert(collections)
        .values({
          name: body.name.trim(),
          query: body.query.trim(),
        })
        .returning();

      refreshCollectionMatchCount(db, row!.id);

      publish({ type: "collection.updated", collectionId: row!.id });

      return {
        kind: "smart" as const,
        id: row!.id,
        name: row!.name,
        query: row!.query,
        matchCount: readCachedMatchCount(db, row!.id),
        createdAt: toIso(row!.createdAt),
        updatedAt: toIso(row!.updatedAt),
      };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        query: t.String({ minLength: 1 }),
      }),
    },
  )
  .group("/:id", (app) =>
    app
      .get(
        "/set-ids",
        async ({ db, params, query, set }) => {
          const id = Number(params.id);
          const [col] = await db
            .select()
            .from(collections)
            .where(eq(collections.id, id))
            .limit(1);
          if (!col) {
            set.status = 404;
            return { error: "Collection not found" };
          }

          try {
            const resolved = await resolveSmartSetOnlineIds(db, col.query, {
              limit: query.limit,
            });
            return {
              kind: "smart" as const,
              id: col.id,
              name: col.name,
              beatmapsetIds: resolved.beatmapsetIds,
              unresolvedInternalSets: resolved.unresolvedInternalSets,
              total: resolved.total,
            };
          } catch (err) {
            if (err instanceof QueryParseError) {
              set.status = 400;
              return { error: err.message };
            }
            throw err;
          }
        },
        {
          params: t.Object({ id: t.String() }),
          query: t.Object({
            limit: t.Optional(t.Numeric()),
          }),
        },
      )
      .patch(
        "/",
        async ({ db, params, body, set }) => {
          const id = Number(params.id);
          const [existing] = await db
            .select()
            .from(collections)
            .where(eq(collections.id, id))
            .limit(1);
          if (!existing) {
            set.status = 404;
            return { error: "Collection not found" };
          }

          if (body.query != null) {
            try {
              parseQuery(body.query);
            } catch (err) {
              if (err instanceof QueryParseError) {
                set.status = 400;
                return { error: err.message };
              }
              throw err;
            }
          }

          const [row] = await db
            .update(collections)
            .set({
              name: body.name?.trim() ?? existing.name,
              query: body.query?.trim() ?? existing.query,
              updatedAt: new Date(),
            })
            .where(eq(collections.id, id))
            .returning();

          refreshCollectionMatchCount(db, id);

          publish({ type: "collection.updated", collectionId: id });

          return {
            id: row!.id,
            name: row!.name,
            query: row!.query,
            matchCount: readCachedMatchCount(db, id),
            createdAt: toIso(row!.createdAt),
            updatedAt: toIso(row!.updatedAt),
          };
        },
        {
          params: t.Object({ id: t.String() }),
          body: t.Object({
            name: t.Optional(t.String({ minLength: 1 })),
            query: t.Optional(t.String({ minLength: 1 })),
          }),
        },
      )
      .delete(
        "/",
        async ({ db, params, set }) => {
          const id = Number(params.id);
          const deleted = await db
            .delete(collections)
            .where(eq(collections.id, id))
            .returning({ id: collections.id });
          if (deleted.length === 0) {
            set.status = 404;
            return { error: "Collection not found" };
          }
          publish({ type: "collection.updated", collectionId: id });
          return { ok: true };
        },
        {
          params: t.Object({ id: t.String() }),
        },
      )
      .get(
        "/export",
        async ({ db, params, set }) => {
          const id = Number(params.id);
          const [col] = await db
            .select()
            .from(collections)
            .where(eq(collections.id, id))
            .limit(1);
          if (!col) {
            set.status = 404;
            return { error: "Collection not found" };
          }

          try {
            const { setIds } = listDistinctSetIds(db, col.query);
            const pack = await buildCollectionExportZip(db, setIds, col.name);
            if (isOszBuildError(pack)) {
              set.status = pack.status;
              return { error: pack.error };
            }
            return new Response(Buffer.from(pack.bytes), {
              headers: {
                "content-type": "application/zip",
                "content-disposition": oszContentDisposition(pack.filename),
                "cache-control": "no-store",
              },
            });
          } catch (err) {
            if (err instanceof QueryParseError) {
              set.status = 400;
              return { error: err.message };
            }
            throw err;
          }
        },
        {
          params: t.Object({ id: t.String() }),
        },
      )
      .get(
        "/results",
        async ({ db, params, query, set }) => {
          const id = Number(params.id);
          const [col] = await db
            .select()
            .from(collections)
            .where(eq(collections.id, id))
            .limit(1);
          if (!col) {
            set.status = 404;
            return { error: "Collection not found" };
          }

          const page = Math.max(1, query.page ?? 1);
          const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 24));

          try {
            const result = searchBeatmaps(db, col.query, {
              page,
              pageSize,
              knownTotal: col.cachedMatchCount ?? undefined,
            });
            return {
              collection: {
                id: col.id,
                name: col.name,
                query: col.query,
              },
              page: result.page,
              pageSize: result.pageSize,
              total: result.total,
              items: result.items.map((r) => ({
                id: r.id,
                title: r.title,
                artist: r.artist,
                difficultyName: r.difficultyName,
                starRating: r.starRating,
                bpm: r.bpm,
                rulesetShortName: r.rulesetShortName,
                mapperUsername: r.mapperUsername,
                setOnlineId: r.setOnlineId,
                backgroundFileHash: r.backgroundFileHash,
                playCount: r.playCount,
                bestAccuracy: r.bestAccuracy,
                bestPp: r.bestPp,
                lastPlayedAt: toIso(r.lastPlayedAt),
                masteryLevel: r.masteryLevel,
                sunnyEstDiff: r.sunnyEstDiff ?? null,
                sunnyStar: r.sunnyStar ?? null,
                danielEstDiff: r.danielEstDiff ?? null,
                danielStar: r.danielStar ?? null,
                keyCount: r.keyCount ?? null,
              })),
            };
          } catch (err) {
            if (err instanceof QueryParseError) {
              set.status = 400;
              return { error: err.message };
            }
            throw err;
          }
        },
        {
          params: t.Object({ id: t.String() }),
          query: t.Object({
            page: t.Optional(t.Numeric()),
            pageSize: t.Optional(t.Numeric()),
          }),
        },
      ),
  );
