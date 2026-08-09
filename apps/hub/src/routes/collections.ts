import Elysia, { status, t } from "elysia";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  collections,
  collectionFavorites,
  collectionMaps,
  collectionTags,
  hubUsers,
  VALID_TAGS,
  type Tag,
} from "@roxysu/db/hub";
import { requireAuth, jwtPlugin, optionalViewerUserId } from "../middleware/auth";
import { bearer } from "@elysiajs/bearer";

// ---------------------------------------------------------------------------
// Helper — build the collection list item shape
// ---------------------------------------------------------------------------
async function buildCollectionItem(
  collectionId: number,
  viewerUserId?: number
) {
  const col = await db
    .select({
      id: collections.id,
      name: collections.name,
      description: collections.description,
      downloadCount: collections.downloadCount,
      createdAt: collections.createdAt,
      ownerId: collections.ownerId,
      ownerUsername: hubUsers.username,
      ownerAvatarUrl: hubUsers.avatarUrl,
      ownerOsuId: hubUsers.osuId,
    })
    .from(collections)
    .innerJoin(hubUsers, eq(collections.ownerId, hubUsers.id))
    .where(eq(collections.id, collectionId))
    .get();

  if (!col) return null;

  const [tags, maps, favoriteCount, favoritedByMe] = await Promise.all([
    db
      .select({ tag: collectionTags.tag })
      .from(collectionTags)
      .where(eq(collectionTags.collectionId, collectionId)),

    db
      .select({ count: count() })
      .from(collectionMaps)
      .where(eq(collectionMaps.collectionId, collectionId))
      .get(),

    db
      .select({ count: count() })
      .from(collectionFavorites)
      .where(eq(collectionFavorites.collectionId, collectionId))
      .get(),

    viewerUserId
      ? db
          .select()
          .from(collectionFavorites)
          .where(
            and(
              eq(collectionFavorites.collectionId, collectionId),
              eq(collectionFavorites.userId, viewerUserId)
            )
          )
          .get()
      : Promise.resolve(null),
  ]);

  return {
    id: col.id,
    name: col.name,
    description: col.description,
    downloadCount: col.downloadCount,
    createdAt: col.createdAt,
    owner: {
      id: col.ownerId,
      osuId: col.ownerOsuId,
      username: col.ownerUsername,
      avatarUrl: col.ownerAvatarUrl,
    },
    tags: tags.map((row) => row.tag),
    mapCount: maps?.count ?? 0,
    favoriteCount: favoriteCount?.count ?? 0,
    favoritedByMe: !!favoritedByMe,
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export const collectionRoutes = new Elysia({ prefix: "/collections" })
  .use(jwtPlugin)
  .use(bearer())

  // -------------------------------------------------------------------------
  // GET /collections — paginated list with optional tag filter
  // -------------------------------------------------------------------------
  .get(
    "/",
    async ({ query, jwt, bearer }) => {
      const { page = 0, limit = 20, tag } = query;

      const viewerUserId = await optionalViewerUserId(jwt, bearer);

      let collectionIds: number[];

      if (tag) {
        const rows = await db
          .select({ collectionId: collectionTags.collectionId })
          .from(collectionTags)
          .where(eq(collectionTags.tag, tag))
          .innerJoin(collections, eq(collectionTags.collectionId, collections.id));

        collectionIds = rows.map((r) => r.collectionId);
        if (collectionIds.length === 0) return { data: [], total: 0, page, limit };
      } else {
        const rows = await db
          .select({ id: collections.id })
          .from(collections)
          .orderBy(desc(collections.createdAt))
          .limit(limit)
          .offset(page * limit);
        collectionIds = rows.map((r) => r.id);
      }

      const items = await Promise.all(
        collectionIds.map((id) => buildCollectionItem(id, viewerUserId))
      );

      const totalRow = await db
        .select({ count: count() })
        .from(collections)
        .get();

      return {
        data: items.filter(Boolean),
        total: totalRow?.count ?? 0,
        page,
        limit,
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 0 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        tag: t.Optional(t.String()),
      }),
    }
  )

  // -------------------------------------------------------------------------
  // GET /collections/:id/export — public beatmapset ID list for download
  // -------------------------------------------------------------------------
  .get(
    "/:id/export",
    async ({ params }) => {
      const col = await db
        .select()
        .from(collections)
        .where(eq(collections.id, params.id))
        .get();
      if (!col) return status(404, { message: "Collection not found" });

      await db
        .update(collections)
        .set({ downloadCount: sql`${collections.downloadCount} + 1` })
        .where(eq(collections.id, params.id));

      const maps = await db
        .select({ beatmapsetId: collectionMaps.beatmapsetId })
        .from(collectionMaps)
        .where(eq(collectionMaps.collectionId, params.id));

      return {
        collectionId: params.id,
        name: col.name,
        beatmapsetIds: maps.map((m) => m.beatmapsetId),
      };
    },
    { params: t.Object({ id: t.Numeric() }) }
  )

  // -------------------------------------------------------------------------
  // GET /collections/:id/missing — public diff against what the user already has
  // -------------------------------------------------------------------------
  .get(
    "/:id/missing",
    async ({ params, query }) => {
      const col = await db
        .select()
        .from(collections)
        .where(eq(collections.id, params.id))
        .get();
      if (!col) return status(404, { message: "Collection not found" });

      const have = new Set(
        (Array.isArray(query.have) ? query.have : [query.have])
          .filter(Boolean)
          .map(Number)
      );

      const maps = await db
        .select({ beatmapsetId: collectionMaps.beatmapsetId })
        .from(collectionMaps)
        .where(eq(collectionMaps.collectionId, params.id));

      const missing = maps
        .map((m) => m.beatmapsetId)
        .filter((id) => !have.has(id));

      return { collectionId: params.id, missing, total: maps.length };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      query: t.Object({
        have: t.Optional(t.Union([t.Array(t.String()), t.String()])),
      }),
    }
  )

  // -------------------------------------------------------------------------
  // GET /collections/me/favorites — before /:id so "me" is not parsed as id
  // -------------------------------------------------------------------------
  .use(
    new Elysia()
      .use(requireAuth)
      .get("/me/favorites", async ({ user }) => {
        const rows = await db
          .select({ collectionId: collectionFavorites.collectionId })
          .from(collectionFavorites)
          .where(eq(collectionFavorites.userId, user.sub));

        const items = await Promise.all(
          rows.map((r) => buildCollectionItem(r.collectionId, user.sub))
        );

        return { data: items.filter(Boolean) };
      })
  )

  // -------------------------------------------------------------------------
  // GET /collections/:id — single collection detail (public)
  // -------------------------------------------------------------------------
  .get(
    "/:id",
    async ({ params, jwt, bearer }) => {
      const viewerUserId = await optionalViewerUserId(jwt, bearer);

      const item = await buildCollectionItem(params.id, viewerUserId);
      if (!item) return status(404, { message: "Collection not found" });

      const maps = await db
        .select({
          beatmapsetId: collectionMaps.beatmapsetId,
          mapName: collectionMaps.mapName,
        })
        .from(collectionMaps)
        .where(eq(collectionMaps.collectionId, params.id));

      return { ...item, maps };
    },
    { params: t.Object({ id: t.Numeric() }) }
  )

  // -------------------------------------------------------------------------
  // Authenticated write routes
  // -------------------------------------------------------------------------
  .use(requireAuth)

  .post(
    "/",
    async ({ body, user }) => {
      const invalidTags = body.tags.filter(
        (tag) => !VALID_TAGS.includes(tag as Tag)
      );
      if (invalidTags.length > 0) {
        return status(400, { message: `Invalid tags: ${invalidTags.join(", ")}` });
      }

      const col = await db
        .insert(collections)
        .values({
          ownerId: user.sub,
          name: body.name,
          description: body.description ?? "",
        })
        .returning()
        .get();

      if (body.beatmapsetIds.length > 0) {
        await db.insert(collectionMaps).values(
          body.beatmapsetIds.map((id, i) => ({
            collectionId: col.id,
            beatmapsetId: id,
            mapName: body.mapNames?.[i] ?? "",
          }))
        );
      }

      if (body.tags.length > 0) {
        await db.insert(collectionTags).values(
          body.tags.map((tag) => ({
            collectionId: col.id,
            tag,
          }))
        );
      }

      return { id: col.id, message: "Collection created" };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        description: t.Optional(t.String({ maxLength: 500 })),
        beatmapsetIds: t.Array(t.Number(), { minItems: 1 }),
        mapNames: t.Optional(t.Array(t.String())),
        tags: t.Array(t.String()),
      }),
    }
  )

  .put(
    "/:id",
    async ({ params, body, user }) => {
      const col = await db
        .select()
        .from(collections)
        .where(eq(collections.id, params.id))
        .get();

      if (!col) return status(404, { message: "Collection not found" });
      if (col.ownerId !== user.sub && user.role !== "admin") {
        return status(403, { message: "Not your collection" });
      }

      if (body.tags) {
        const invalidTags = body.tags.filter(
          (tag) => !VALID_TAGS.includes(tag as Tag)
        );
        if (invalidTags.length > 0) {
          return status(400, { message: `Invalid tags: ${invalidTags.join(", ")}` });
        }
      }

      await db
        .update(collections)
        .set({
          ...(body.name && { name: body.name }),
          ...(body.description !== undefined && { description: body.description }),
          updatedAt: new Date(),
        })
        .where(eq(collections.id, params.id));

      if (body.tags) {
        await db
          .delete(collectionTags)
          .where(eq(collectionTags.collectionId, params.id));
        if (body.tags.length > 0) {
          await db.insert(collectionTags).values(
            body.tags.map((tag) => ({ collectionId: params.id, tag }))
          );
        }
      }

      return { message: "Collection updated" };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        description: t.Optional(t.String({ maxLength: 500 })),
        tags: t.Optional(t.Array(t.String())),
      }),
    }
  )

  .delete(
    "/:id",
    async ({ params, user }) => {
      const col = await db
        .select()
        .from(collections)
        .where(eq(collections.id, params.id))
        .get();

      if (!col) return status(404, { message: "Collection not found" });
      if (col.ownerId !== user.sub && user.role !== "admin") {
        return status(403, { message: "Not your collection" });
      }

      await db.delete(collections).where(eq(collections.id, params.id));
      return { message: "Collection deleted" };
    },
    { params: t.Object({ id: t.Numeric() }) }
  )

  .post(
    "/:id/favorite",
    async ({ params, user }) => {
      const col = await db
        .select()
        .from(collections)
        .where(eq(collections.id, params.id))
        .get();
      if (!col) return status(404, { message: "Collection not found" });

      await db
        .insert(collectionFavorites)
        .values({ userId: user.sub, collectionId: params.id })
        .onConflictDoNothing();

      return { message: "Favorited" };
    },
    { params: t.Object({ id: t.Numeric() }) }
  )

  .delete(
    "/:id/favorite",
    async ({ params, user }) => {
      await db
        .delete(collectionFavorites)
        .where(
          and(
            eq(collectionFavorites.userId, user.sub),
            eq(collectionFavorites.collectionId, params.id)
          )
        );
      return { message: "Unfavorited" };
    },
    { params: t.Object({ id: t.Numeric() }) }
  );
