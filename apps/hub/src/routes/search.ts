import Elysia, { t } from "elysia";
import { hashQueryParams, lookupCache, refreshCache, sliceIds } from "../services/cache";
import { searchPage, type HinamizawaSearchParams } from "../services/hinamizawa";
import { allowRateLimit } from "../services/rateLimit";

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** In-flight background refreshes — at most one per cache row at a time. */
const refreshing = new Set<number>();

export const searchRoutes = new Elysia({ prefix: "/search" }).get(
  "/",
  async ({ query, request, set }) => {
    const ip = clientIp(request);
    if (!allowRateLimit(`search:${ip}`, { limit: 60, windowMs: 60_000 })) {
      set.status = 429;
      return { message: "Too many search requests" };
    }

    const {
      page = 0,
      limit = 100,
      // pull search params from query, rest forwarded to hinamizawa
      ...rest
    } = query;

    const params: HinamizawaSearchParams = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined && v !== "") params[k] = v;
    }

    const queryHash = hashQueryParams(params);
    const { status, row } = await lookupCache(queryHash);

    // -----------------------------------------------------------------------
    // Cache HIT (fresh or stale)
    // -----------------------------------------------------------------------
    if (row) {
      if (status === "hit-stale" && !refreshing.has(row.id)) {
        // Cap live upstream work: one refresh per cache id at a time, and
        // a coarse IP budget for background refreshes.
        if (allowRateLimit(`search-refresh:${ip}`, { limit: 10, windowMs: 60_000 })) {
          refreshing.add(row.id);
          refreshCache(row.id)
            .catch((err) =>
              console.error("[search] Background refresh failed:", err),
            )
            .finally(() => refreshing.delete(row.id));
        }
      }

      const { ids, total } = sliceIds(row.beatmapsetIds, page, limit);

      return {
        cached: true,
        stale: status === "hit-stale",
        cachedAt: row.cachedAt,
        label: row.label || null,
        total,
        page,
        limit,
        beatmapsetIds: ids,
      };
    }

    // -----------------------------------------------------------------------
    // Cache MISS — live forward to hinamizawa (stricter budget)
    // -----------------------------------------------------------------------
    if (!allowRateLimit(`search-live:${ip}`, { limit: 20, windowMs: 60_000 })) {
      set.status = 429;
      return { message: "Too many uncached search requests" };
    }

    try {
      const live = await searchPage(params, page, limit);
      return {
        cached: false,
        stale: false,
        cachedAt: null,
        label: null,
        total: live.total_count,
        page,
        limit,
        beatmapsetIds: live.results.map((r: any) => r.SetID),
      };
    } catch (err) {
      console.error("[search] Live hinamizawa search failed:", err);
      throw err;
    }
  },
  {
    query: t.Object(
      {
        page: t.Optional(t.Numeric({ minimum: 0 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        // hinamizawa params — all optional strings/numbers passed through
        query: t.Optional(t.String()),
        mode: t.Optional(t.Numeric()),
        status: t.Optional(t.String()),
        min_stars: t.Optional(t.Numeric()),
        max_stars: t.Optional(t.Numeric()),
        min_bpm: t.Optional(t.Numeric()),
        max_bpm: t.Optional(t.Numeric()),
        min_length: t.Optional(t.Numeric()),
        max_length: t.Optional(t.Numeric()),
        creator: t.Optional(t.String()),
        sort: t.Optional(t.String()),
      },
      { additionalProperties: true }
    ),
  }
);
