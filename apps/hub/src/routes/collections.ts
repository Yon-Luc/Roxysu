import Elysia, { status, t } from "elysia";
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
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
import { computeCollectionStatsFromSetIds, isHubRuleset } from "../services/collectionStats";
import { uniqueBeatmapsetIds, uniqueTags } from "../services/collectionWrite";
import { hubModeTagForRuleset, parseHubSearchQuery } from "../services/hubSearchQuery";
import { allowRateLimit } from "../services/rateLimit";
import { clientIp } from "../services/clientIp";

function parseTagFilters(raw: {
  tag?: string;
  tags?: string | string[];
}): Tag[] {
  const parts: string[] = [];
  if (typeof raw.tags === "string") {
    parts.push(...raw.tags.split(","));
  } else if (Array.isArray(raw.tags)) {
    for (const entry of raw.tags) {
      parts.push(...String(entry).split(","));
    }
  }
  if (raw.tag) parts.push(raw.tag);

  const out: Tag[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const tag = part.trim();
    if (!tag || seen.has(tag)) continue;
    if (!VALID_TAGS.includes(tag as Tag)) continue;
    seen.add(tag);
    out.push(tag as Tag);
  }
  return out;
}

/** Collection IDs that include every selected tag (AND). */
async function collectionIdsMatchingAllTags(tags: Tag[]): Promise<number[]> {
  if (tags.length === 0) return [];

  let matched: Set<number> | null = null;
  for (const tag of tags) {
    const rows = await db
      .select({ collectionId: collectionTags.collectionId })
      .from(collectionTags)
      .where(eq(collectionTags.tag, tag));
    const ids = new Set(rows.map((r) => r.collectionId));
    if (matched == null) {
      matched = ids;
    } else {
      for (const id of [...matched]) {
        if (!ids.has(id)) matched.delete(id);
      }
    }
    if (matched.size === 0) return [];
  }
  return [...(matched ?? [])];
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Case-insensitive match on collection name or owner username. */
function textSearchFilter(text: string): SQL | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const pattern = `%${escapeLike(trimmed.toLowerCase())}%`;
  return or(
    sql`lower(${collections.name}) like ${pattern} escape '\\'`,
    sql`lower(${hubUsers.username}) like ${pattern} escape '\\'`,
  );
}

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
      updatedAt: collections.updatedAt,
      starsMin: collections.starsMin,
      starsMax: collections.starsMax,
      dominantMode: collections.dominantMode,
      dominantKeys: collections.dominantKeys,
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

  const [tags, maps, favoriteCount, favoritedByMe, allSetIds] =
    await Promise.all([
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
                eq(collectionFavorites.userId, viewerUserId),
              ),
            )
            .get()
        : Promise.resolve(null),

      db
        .select({ beatmapsetId: collectionMaps.beatmapsetId })
        .from(collectionMaps)
        .where(eq(collectionMaps.collectionId, collectionId))
        .orderBy(collectionMaps.id),
    ]);

  return {
    id: col.id,
    name: col.name,
    description: col.description,
    downloadCount: col.downloadCount,
    createdAt:
      col.createdAt instanceof Date
        ? col.createdAt.toISOString()
        : new Date(col.createdAt as number).toISOString(),
    updatedAt:
      col.updatedAt instanceof Date
        ? col.updatedAt.toISOString()
        : new Date(col.updatedAt as number).toISOString(),
    starsMin: col.starsMin,
    starsMax: col.starsMax,
    dominantMode:
      col.dominantMode && isHubRuleset(col.dominantMode)
        ? col.dominantMode
        : null,
    dominantKeys: col.dominantKeys,
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
    previewBeatmapsetIds: allSetIds.slice(0, 4).map((m) => m.beatmapsetId),
    beatmapsetIds: allSetIds.map((m) => m.beatmapsetId),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export const collectionRoutes = new Elysia({ prefix: "/collections" })
  .use(jwtPlugin)
  .use(bearer())

  // -------------------------------------------------------------------------
  // GET /collections — paginated list with optional tag + text search
  // -------------------------------------------------------------------------
  .get(
    "/",
    async ({ query, jwt, bearer }) => {
      const { page = 0, limit = 20, q } = query;
      const selectedTags = parseTagFilters(query);
      const search = parseHubSearchQuery(q);
      const textFilter = textSearchFilter(search.text);

      const viewerUserId = await optionalViewerUserId(jwt, bearer);

      const filters: SQL[] = [];
      if (selectedTags.length > 0) {
        const matchedIds = await collectionIdsMatchingAllTags(selectedTags);
        if (matchedIds.length === 0) {
          return { data: [], total: 0, page, limit };
        }
        filters.push(inArray(collections.id, matchedIds));
      }
      if (textFilter) filters.push(textFilter);
      if (search.mode) {
        const modeTag = hubModeTagForRuleset(search.mode);
        const taggedIds = await collectionIdsMatchingAllTags([modeTag]);
        const modeMatch = eq(collections.dominantMode, search.mode);
        filters.push(
          taggedIds.length > 0
            ? or(modeMatch, inArray(collections.id, taggedIds))!
            : modeMatch,
        );
      }
      if (search.keys != null) {
        filters.push(eq(collections.dominantKeys, search.keys));
      }
      if (search.starsMin != null) {
        filters.push(gte(collections.starsMax, search.starsMin));
      }
      if (search.starsMax != null) {
        filters.push(lte(collections.starsMin, search.starsMax));
      }

      const where = filters.length > 0 ? and(...filters) : undefined;

      const [rows, totalRow] = await Promise.all([
        db
          .select({ id: collections.id })
          .from(collections)
          .innerJoin(hubUsers, eq(collections.ownerId, hubUsers.id))
          .where(where)
          .orderBy(desc(collections.createdAt))
          .limit(limit)
          .offset(page * limit),
        db
          .select({ count: count() })
          .from(collections)
          .innerJoin(hubUsers, eq(collections.ownerId, hubUsers.id))
          .where(where)
          .get(),
      ]);

      const items = await Promise.all(
        rows.map((row) => buildCollectionItem(row.id, viewerUserId)),
      );

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
        /** Free text + filters like mode=m key=7 stars>=5 */
        q: t.Optional(t.String({ maxLength: 200 })),
        /** @deprecated Prefer `tags` (comma-separated or repeated). */
        tag: t.Optional(t.String()),
        tags: t.Optional(t.Union([t.String(), t.Array(t.String())])),
      }),
    },
  )

  // -------------------------------------------------------------------------
  // GET /collections/:id/export — public beatmapset ID list for download
  // -------------------------------------------------------------------------
  .get(
    "/:id/export",
    async ({ params, request, server, set }) => {
      const ip = clientIp(request, server);
      if (!allowRateLimit(`export:${ip}`, { limit: 30, windowMs: 60_000 })) {
        set.status = 429;
        return { message: "Too many export requests" };
      }

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
      const tags = uniqueTags(body.tags);
      const invalidTags = tags.filter((tag) => !VALID_TAGS.includes(tag as Tag));
      if (invalidTags.length > 0) {
        return status(400, { message: `Invalid tags: ${invalidTags.join(", ")}` });
      }

      const maps = uniqueBeatmapsetIds(body.beatmapsetIds, body.mapNames);
      if (maps.beatmapsetIds.length === 0) {
        return status(400, { message: "At least one beatmapset id is required" });
      }

      const stats = await computeCollectionStatsFromSetIds(maps.beatmapsetIds);

      const created = await db.transaction(async (tx) => {
        const col = await tx
          .insert(collections)
          .values({
            ownerId: user.sub,
            name: body.name,
            description: body.description ?? "",
            starsMin: stats.starsMin,
            starsMax: stats.starsMax,
            dominantMode: stats.dominantMode,
            dominantKeys: stats.dominantKeys,
          })
          .returning()
          .get();

        await tx.insert(collectionMaps).values(
          maps.beatmapsetIds.map((id, i) => ({
            collectionId: col.id,
            beatmapsetId: id,
            mapName: maps.mapNames[i] ?? "",
          })),
        );

        if (tags.length > 0) {
          await tx.insert(collectionTags).values(
            tags.map((tag) => ({
              collectionId: col.id,
              tag,
            })),
          );
        }

        return col;
      });

      return { id: created.id, message: "Collection created" };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        description: t.Optional(t.String({ maxLength: 500 })),
        beatmapsetIds: t.Array(t.Number(), {
          minItems: 1,
          maxItems: 2000,
        }),
        mapNames: t.Optional(
          t.Array(t.String({ maxLength: 200 }), { maxItems: 2000 }),
        ),
        tags: t.Array(t.String(), { maxItems: 32 }),
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

      const tags = body.tags != null ? uniqueTags(body.tags) : null;
      if (tags) {
        const invalidTags = tags.filter(
          (tag) => !VALID_TAGS.includes(tag as Tag),
        );
        if (invalidTags.length > 0) {
          return status(400, { message: `Invalid tags: ${invalidTags.join(", ")}` });
        }
      }

      const maps =
        body.beatmapsetIds != null
          ? uniqueBeatmapsetIds(body.beatmapsetIds, body.mapNames)
          : null;
      if (maps && maps.beatmapsetIds.length === 0) {
        return status(400, { message: "At least one beatmapset id is required" });
      }

      const stats = maps
        ? await computeCollectionStatsFromSetIds(maps.beatmapsetIds)
        : null;

      await db.transaction(async (tx) => {
        await tx
          .update(collections)
          .set({
            ...(body.name && { name: body.name }),
            ...(body.description !== undefined && { description: body.description }),
            ...(stats
              ? {
                  starsMin: stats.starsMin,
                  starsMax: stats.starsMax,
                  dominantMode: stats.dominantMode,
                  dominantKeys: stats.dominantKeys,
                }
              : {}),
            updatedAt: new Date(),
          })
          .where(eq(collections.id, params.id));

        if (tags) {
          await tx
            .delete(collectionTags)
            .where(eq(collectionTags.collectionId, params.id));
          if (tags.length > 0) {
            await tx.insert(collectionTags).values(
              tags.map((tag) => ({ collectionId: params.id, tag })),
            );
          }
        }

        if (maps) {
          await tx
            .delete(collectionMaps)
            .where(eq(collectionMaps.collectionId, params.id));
          await tx.insert(collectionMaps).values(
            maps.beatmapsetIds.map((id, i) => ({
              collectionId: params.id,
              beatmapsetId: id,
              mapName: maps.mapNames[i] ?? "",
            })),
          );
        }
      });

      return { message: "Collection updated" };
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
        description: t.Optional(t.String({ maxLength: 500 })),
        tags: t.Optional(t.Array(t.String(), { maxItems: 32 })),
        beatmapsetIds: t.Optional(
          t.Array(t.Number(), { minItems: 1, maxItems: 2000 }),
        ),
        mapNames: t.Optional(
          t.Array(t.String({ maxLength: 200 }), { maxItems: 2000 }),
        ),
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
