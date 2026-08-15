import Elysia, { status, t } from "elysia";
import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { searchCache } from "@roxysu/db/hub";
import { requireAdmin } from "../middleware/auth";
import {
  baseParamsFromCacheQuery,
  hashQueryParams,
  normalizeRefreshIntervalMinutes,
  refreshCache,
  type CacheQueryParams,
} from "../services/cache";
import { hubCacheTtlMs } from "../services/hubEnv";

/** Base prime identity only — secondary filters are request-time on GET /search. */
const queryParamsSchema = t.Object({
  status: t.Optional(t.String()),
  mode: t.Optional(t.Numeric()),
  sort: t.Optional(t.String()),
  /** Roxysu-only mania keymode filter (not sent to Hinamizawa). */
  key: t.Optional(t.Numeric({ minimum: 1, maximum: 18 })),
});

function serializeCacheRow(row: typeof searchCache.$inferSelect) {
  const ageMs = Date.now() - new Date(row.cachedAt).getTime();
  const interval = row.refreshIntervalMinutes;
  const lastRefresh = row.lastRefreshAt
    ? new Date(row.lastRefreshAt).getTime()
    : null;
  const nextRefreshAt =
    interval != null && interval > 0 && lastRefresh != null
      ? new Date(lastRefresh + interval * 60_000).toISOString()
      : null;

  return {
    id: row.id,
    label: row.label,
    queryHash: row.queryHash,
    queryParams: JSON.parse(row.queryParams) as CacheQueryParams,
    totalCount: row.totalCount,
    cachedAt: row.cachedAt,
    stale: ageMs > hubCacheTtlMs(),
    ageMs,
    refreshIntervalMinutes: row.refreshIntervalMinutes,
    lastRefreshAt: row.lastRefreshAt,
    nextRefreshAt,
    refreshError: row.refreshError,
  };
}

export const adminRoutes = new Elysia({ prefix: "/admin" })
  .use(requireAdmin)

  .get("/cache", async () => {
    const rows = await db
      .select()
      .from(searchCache)
      .orderBy(desc(searchCache.cachedAt));
    return rows.map(serializeCacheRow);
  })

  .post(
    "/cache",
    async ({ body }) => {
      const params = baseParamsFromCacheQuery(
        body.query_params as CacheQueryParams,
      );
      const queryHash = hashQueryParams(params);
      const refreshIntervalMinutes = normalizeRefreshIntervalMinutes(
        body.refreshIntervalMinutes,
      );

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

      const inserted = await db
        .insert(searchCache)
        .values({
          queryHash,
          queryParams: JSON.stringify(params),
          beatmapsetIds: "[]",
          totalCount: 0,
          label: body.label ?? "",
          refreshIntervalMinutes,
        })
        .returning({ id: searchCache.id })
        .get();

      try {
        await refreshCache(inserted.id);
      } catch (err) {
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
        refreshIntervalMinutes,
        message: "Cache entry created and primed",
      };
    },
    {
      body: t.Object({
        label: t.Optional(t.String({ maxLength: 100 })),
        refreshIntervalMinutes: t.Optional(
          t.Nullable(t.Numeric({ minimum: 0 })),
        ),
        query_params: queryParamsSchema,
      }),
    },
  )

  .patch(
    "/cache/:id",
    async ({ params, body }) => {
      const row = await db
        .select()
        .from(searchCache)
        .where(eq(searchCache.id, params.id))
        .get();
      if (!row) return status(404, { message: "Cache entry not found" });

      const patch: Partial<typeof searchCache.$inferInsert> = {};
      if (body.label !== undefined) patch.label = body.label;
      if (body.refreshIntervalMinutes !== undefined) {
        patch.refreshIntervalMinutes = normalizeRefreshIntervalMinutes(
          body.refreshIntervalMinutes,
        );
      }

      if (Object.keys(patch).length === 0) {
        return serializeCacheRow(row);
      }

      await db
        .update(searchCache)
        .set(patch)
        .where(eq(searchCache.id, params.id));

      const updated = await db
        .select()
        .from(searchCache)
        .where(eq(searchCache.id, params.id))
        .get();
      return serializeCacheRow(updated!);
    },
    {
      params: t.Object({ id: t.Numeric() }),
      body: t.Object({
        label: t.Optional(t.String({ maxLength: 100 })),
        refreshIntervalMinutes: t.Optional(
          t.Nullable(t.Numeric({ minimum: 0 })),
        ),
      }),
    },
  )

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
        const message = err instanceof Error ? err.message : String(err);
        await db
          .update(searchCache)
          .set({
            refreshError: message.slice(0, 500),
            refreshBackoffUntil: new Date(Date.now() + 15 * 60_000),
          })
          .where(eq(searchCache.id, params.id));
        console.error("[admin] Refresh failed:", err);
        return status(502, {
          message: "Hinamizawa search failed during refresh",
        });
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
        lastRefreshAt: updated?.lastRefreshAt,
        message: "Cache refreshed",
      };
    },
    { params: t.Object({ id: t.Numeric() }) },
  )

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
    { params: t.Object({ id: t.Numeric() }) },
  );
