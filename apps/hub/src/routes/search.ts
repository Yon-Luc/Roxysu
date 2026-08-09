import Elysia, { t } from "elysia";
import { hashQueryParams, lookupCache, refreshCache, sliceIds } from "../services/cache";
import { searchPage, type HinamizawaSearchParams } from "../services/hinamizawa";

export const searchRoutes = new Elysia({ prefix: "/search" }).get(
  "/",
  async ({ query }) => {
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
      if (status === "hit-stale") {
        // Return current cache immediately, kick off background refresh
        refreshCache(row.id).catch((err) =>
          console.error("[search] Background refresh failed:", err)
        );
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
    // Cache MISS — live forward to hinamizawa
    // -----------------------------------------------------------------------
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
