import Elysia, { status, t } from "elysia";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { searchCache } from "@roxysu/db/hub";
import { requireAdmin } from "../middleware/auth";
import { fetchAllBeatmapsetIds, type HinamizawaSearchParams } from "../services/hinamizawa";
import { hashQueryParams, refreshCache } from "../services/cache";

const TTL_MS = parseInt(process.env.HUB_CACHE_TTL_MS ?? "86400000", 10);

export const adminRoutes = new Elysia({ prefix: "/admin" })
  .use(requireAdmin)

  // -------------------------------------------------------------------------
  // GET /admin/cache — list all entries with staleness info
  // -------------------------------------------------------------------------
  .get("/cache", async () => {
    const rows = await db
      .select()
      .from(searchCache)
      .orderBy(desc(searchCache.cachedAt));

    return rows.map((row) => {
      const ageMs = Date.now() - new Date(row.cachedAt).getTime();
      return {
        id: row.id,
        label: row.label,
        queryHash: row.queryHash,
        queryParams: JSON.parse(row.queryParams),
        totalCount: row.totalCount,
        cachedAt: row.cachedAt,
        stale: ageMs > TTL_MS,
        ageMs,
      };
    });
  })

  // -------------------------------------------------------------------------
  // POST /admin/cache — create + immediately prime a cache entry
  // -------------------------------------------------------------------------
  .post(
    "/cache",
    async ({ body }) => {
      const params = body.query_params as HinamizawaSearchParams;
      const queryHash = hashQueryParams(params);

      // Check if already exists
      const existing = await db
        .select()
        .from(searchCache)
        .where(eq(searchCache.queryHash, queryHash))
        .get();

      if (existing) {
        return status(409, {
          message: "Cache entry for these params already exists",
          id: existing.id,
        });
      }

      // Insert placeholder row first
      const inserted = await db
        .insert(searchCache)
        .values({
          queryHash,
          queryParams: JSON.stringify(params),
          beatmapsetIds: "[]",
          totalCount: 0,
          label: body.label ?? "",
        })
        .returning({ id: searchCache.id })
        .get();

      // Prime synchronously so the caller gets confirmation
      // (This may take a while for large result sets — typical ranked mania query
      //  is ~5K sets across ~50 pages, ~30s total at 100/page)
      try {
        await refreshCache(inserted.id);
      } catch (err) {
        // Clean up placeholder on failure
        await db.delete(searchCache).where(eq(searchCache.id, inserted.id));
        console.error("[admin] Cache prime failed:", err);
        return status(502, { message: "Failed to fetch from Hinamizawa" });
      }

      const row = await db
        .select()
        .from(searchCache)
        .where(eq(searchCache.id, inserted.id))
        .get();

      return {
        id: inserted.id,
        queryHash,
        totalCount: row?.totalCount ?? 0,
        message: "Cache entry created and primed",
      };
    },
    {
      body: t.Object({
        label: t.Optional(t.String({ maxLength: 100 })),
        query_params: t.Object(
          {
            status: t.Optional(t.String()),
            mode: t.Optional(t.Numeric()),
            query: t.Optional(t.String()),
            min_stars: t.Optional(t.Numeric()),
            max_stars: t.Optional(t.Numeric()),
            min_bpm: t.Optional(t.Numeric()),
            max_bpm: t.Optional(t.Numeric()),
            creator: t.Optional(t.String()),
            sort: t.Optional(t.String()),
          },
          { additionalProperties: true }
        ),
      }),
    }
  )

  // -------------------------------------------------------------------------
  // POST /admin/cache/:id/refresh — re-run search, update stored IDs
  // -------------------------------------------------------------------------
  .post(
    "/cache/:id/refresh",
    async ({ params }) => {
      const row = await db
        .select()
        .from(searchCache)
        .where(eq(searchCache.id, params.id))
        .get();

      if (!row) return status(404, { message: "Cache entry not found" });

      try {
        await refreshCache(params.id);
      } catch (err) {
        console.error("[admin] Refresh failed:", err);
        return status(502, { message: "Hinamizawa search failed during refresh" });
      }

      const updated = await db
        .select()
        .from(searchCache)
        .where(eq(searchCache.id, params.id))
        .get();

      return {
        id: params.id,
        totalCount: updated?.totalCount ?? 0,
        cachedAt: updated?.cachedAt,
        message: "Cache refreshed",
      };
    },
    { params: t.Object({ id: t.Numeric() }) }
  )

  // -------------------------------------------------------------------------
  // DELETE /admin/cache/:id — drop a cache entry
  // -------------------------------------------------------------------------
  .delete(
    "/cache/:id",
    async ({ params }) => {
      const row = await db
        .select()
        .from(searchCache)
        .where(eq(searchCache.id, params.id))
        .get();

      if (!row) return status(404, { message: "Cache entry not found" });

      await db.delete(searchCache).where(eq(searchCache.id, params.id));
      return { message: "Cache entry deleted" };
    },
    { params: t.Object({ id: t.Numeric() }) }
  );
