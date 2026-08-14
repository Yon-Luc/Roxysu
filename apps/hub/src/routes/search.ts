import Elysia, { t } from "elysia";
import {
  hashQueryParams,
  lookupCache,
  refreshCache,
  sliceIds,
  type CacheQueryParams,
} from "../services/cache";
import { allowRateLimit } from "../services/rateLimit";
import { clientIp } from "../services/clientIp";

const refreshing = new Set<number>();

export const searchRoutes = new Elysia({ prefix: "/search" }).get(
  "/",
  async ({ query, request, server, set }) => {
    const ip = clientIp(request, server);
    if (!allowRateLimit(`search:${ip}`, { limit: 60, windowMs: 60_000 })) {
      set.status = 429;
      return { message: "Too many search requests" };
    }

    const {
      page = 0,
      limit = 100,
      ...rest
    } = query;

    const params: CacheQueryParams = {};
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined && v !== "") params[k] = v as string | number;
    }

    // Normalize keys → key for stable hashing
    if (params.keys != null && params.key == null) {
      params.key = Number(params.keys);
      delete params.keys;
    }

    const queryHash = hashQueryParams(params);
    const { status, row } = await lookupCache(queryHash);

    if (row) {
      if (status === "hit-stale" && !refreshing.has(row.id)) {
        if (
          allowRateLimit(`search-refresh:${ip}`, { limit: 10, windowMs: 60_000 })
        ) {
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

    return {
      cached: false,
      stale: false,
      cachedAt: null,
      label: null,
      total: 0,
      page,
      limit,
      beatmapsetIds: [] as number[],
    };
  },
  {
    query: t.Object({
      page: t.Optional(t.Numeric({ minimum: 0 })),
      limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
      query: t.Optional(t.String({ maxLength: 200 })),
      mode: t.Optional(t.Numeric()),
      status: t.Optional(t.String({ maxLength: 32 })),
      min_stars: t.Optional(t.Numeric()),
      max_stars: t.Optional(t.Numeric()),
      min_bpm: t.Optional(t.Numeric()),
      max_bpm: t.Optional(t.Numeric()),
      min_length: t.Optional(t.Numeric()),
      max_length: t.Optional(t.Numeric()),
      creator: t.Optional(t.String({ maxLength: 100 })),
      sort: t.Optional(t.String({ maxLength: 32 })),
      key: t.Optional(t.Numeric()),
      keys: t.Optional(t.Numeric()),
    }),
  },
);
