import { Elysia, t } from "elysia";
import { desc, eq } from "drizzle-orm";
import { collections } from "@roxysu/db/client.bun";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";
import { publish } from "../shared/events";
import { syncCollectionsToLazer } from "../shared/syncCollections";
import {
  countMatches,
  parseQuery,
  QueryParseError,
  searchBeatmaps,
} from "../query-language";

export const collectionRoutes = new Elysia({ prefix: "/collections" })
  .use(dbPlugin)
  .get("/", async ({ db }) => {
    const rows = await db
      .select()
      .from(collections)
      .orderBy(desc(collections.updatedAt));

    const items = rows.map((c) => {
      let matchCount: number | null = null;
      try {
        matchCount = countMatches(db, c.query);
      } catch {
        matchCount = null;
      }
      return {
        id: c.id,
        name: c.name,
        query: c.query,
        matchCount,
        lazerSyncedAt: toIso(c.lazerSyncedAt),
        createdAt: toIso(c.createdAt),
        updatedAt: toIso(c.updatedAt),
      };
    });

    return { items };
  })
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

      publish({ type: "collection.updated", collectionId: row!.id });

      return {
        id: row!.id,
        name: row!.name,
        query: row!.query,
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

          publish({ type: "collection.updated", collectionId: id });

          return {
            id: row!.id,
            name: row!.name,
            query: row!.query,
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
            const result = searchBeatmaps(db, col.query, { page, pageSize });
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
