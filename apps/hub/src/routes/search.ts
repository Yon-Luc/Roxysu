import Elysia, { t } from "elysia";
import {
  edgeCacheTtlSecondsForRow,
  lookupCacheByBase,
  parseStoredStubs,
  refreshCache,
  secondaryFiltersFromQuery,
  type CacheQueryParams,
} from "../services/cache";
import {
  ensureSearchIndexRows,
  querySearchIndexAll,
  querySearchIndexPage,
  SEARCH_ALL_MAX_SETS,
} from "../services/searchIndex";
import { allowRateLimit } from "../services/rateLimit";
import { clientIp } from "../services/clientIp";
import {
  isHubSearchHttpCacheEnabled,
  isHubSearchIndexEnabled,
} from "../services/hubEnv";
import { db } from "../db";

const refreshing = new Set<number>();

const searchQueryFields = {
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
};

function setNoStore(set: { headers: Record<string, string | number> }) {
  set.headers["Cache-Control"] = "no-store";
  set.headers["CDN-Cache-Control"] = "no-store";
  set.headers["Cloudflare-CDN-Cache-Control"] = "no-store";
}

function setEdgeCache(
  set: { headers: Record<string, string | number> },
  maxAgeSec: number,
) {
  set.headers["Cache-Control"] = "private, no-store";
  set.headers["CDN-Cache-Control"] = `public, max-age=${maxAgeSec}`;
  set.headers["Cloudflare-CDN-Cache-Control"] = `public, max-age=${maxAgeSec}`;
}

function paramsFromQuery(
  rest: Record<string, string | number | undefined>,
): CacheQueryParams {
  const params: CacheQueryParams = {};
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined && v !== "") params[k] = v as string | number;
  }
  if (params.keys != null && params.key == null) {
    params.key = Number(params.keys);
    delete params.keys;
  }
  return params;
}

function emptyMiss(page: number, limit: number) {
  return {
    cached: false as const,
    stale: false,
    cachedAt: null,
    label: null,
    total: 0,
    page,
    limit,
    beatmapsetIds: [] as number[],
    beatmapsets: [] as ReturnType<typeof parseStoredStubs>,
  };
}

async function maybeRefreshStale(
  rowId: number,
  status: "hit-fresh" | "hit-stale" | "miss",
  ip: string,
) {
  if (status !== "hit-stale" || refreshing.has(rowId)) return;
  if (!allowRateLimit(`search-refresh:${ip}`, { limit: 10, windowMs: 60_000 })) {
    return;
  }
  refreshing.add(rowId);
  refreshCache(rowId)
    .catch((err) => console.error("[search] Background refresh failed:", err))
    .finally(() => refreshing.delete(rowId));
}

export const searchRoutes = new Elysia({ prefix: "/search" })
  .get(
    "/all",
    async ({ query, request, server, set }) => {
      const ip = clientIp(request, server);
      if (!allowRateLimit(`search-all:${ip}`, { limit: 10, windowMs: 60_000 })) {
        set.status = 429;
        setNoStore(set);
        return { message: "Too many search dump requests" };
      }

      const { fields = "compact", max, ...rest } = query;
      const params = paramsFromQuery(rest);

      if (!isHubSearchIndexEnabled()) {
        setNoStore(set);
        return {
          cached: false,
          stale: false,
          cachedAt: null,
          label: null,
          total: 0,
          truncated: false,
          beatmapsetIds: [] as number[],
          beatmapsets: [] as Array<{ id: number; artist: string; title: string }>,
        };
      }

      const { status, row } = await lookupCacheByBase(params);
      if (!row) {
        setNoStore(set);
        return {
          cached: false,
          stale: false,
          cachedAt: null,
          label: null,
          total: 0,
          truncated: false,
          beatmapsetIds: [] as number[],
          beatmapsets: [] as Array<{ id: number; artist: string; title: string }>,
        };
      }

      maybeRefreshStale(row.id, status, ip);
      await ensureSearchIndexRows(db, row.id, parseStoredStubs);

      const secondary = secondaryFiltersFromQuery(params);
      const dump = await querySearchIndexAll(db, row.id, secondary, {
        fields: fields === "ids" ? "ids" : fields === "full" ? "full" : "compact",
        maxSets: max,
      });

      setNoStore(set);
      return {
        cached: true,
        stale: status === "hit-stale",
        cachedAt: row.cachedAt,
        label: row.label || null,
        total: dump.total,
        truncated: dump.truncated,
        beatmapsetIds: dump.beatmapsetIds,
        beatmapsets:
          fields === "full"
            ? dump.stubs
            : fields === "ids"
              ? []
              : dump.sets,
      };
    },
    {
      query: t.Object({
        ...searchQueryFields,
        fields: t.Optional(
          t.Union([t.Literal("ids"), t.Literal("compact"), t.Literal("full")]),
        ),
        max: t.Optional(
          t.Numeric({ minimum: 1, maximum: SEARCH_ALL_MAX_SETS }),
        ),
      }),
    },
  )
  .get(
    "/",
    async ({ query, request, server, set }) => {
      const ip = clientIp(request, server);
      if (!allowRateLimit(`search:${ip}`, { limit: 60, windowMs: 60_000 })) {
        set.status = 429;
        setNoStore(set);
        return { message: "Too many search requests" };
      }

      const { page = 0, limit = 100, ...rest } = query;
      const params = paramsFromQuery(rest);

      if (!isHubSearchIndexEnabled()) {
        setNoStore(set);
        return emptyMiss(page, limit);
      }

      const { status, row } = await lookupCacheByBase(params);

      if (row) {
        maybeRefreshStale(row.id, status, ip);
        await ensureSearchIndexRows(db, row.id, parseStoredStubs);

        const secondary = secondaryFiltersFromQuery(params);
        const { stubs, ids, total } = await querySearchIndexPage(
          db,
          row.id,
          secondary,
          page,
          limit,
        );

        if (isHubSearchHttpCacheEnabled()) {
          setEdgeCache(set, edgeCacheTtlSecondsForRow(row));
        } else {
          setNoStore(set);
        }

        return {
          cached: true,
          stale: status === "hit-stale",
          cachedAt: row.cachedAt,
          label: row.label || null,
          total,
          page,
          limit,
          beatmapsetIds: ids,
          beatmapsets: stubs,
        };
      }

      setNoStore(set);
      return emptyMiss(page, limit);
    },
    {
      query: t.Object({
        page: t.Optional(t.Numeric({ minimum: 0 })),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        ...searchQueryFields,
      }),
    },
  );
