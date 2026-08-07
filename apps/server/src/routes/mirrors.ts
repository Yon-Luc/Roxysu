import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-runtime";
import {
  OnlineQueryError,
  diffAgainstLibrary,
  getActiveBeatmapMirrorProvider,
  getMirrorBatchJobState,
  openLastBatchArchivesInOsu,
  parsePositiveSetId,
  probeBeatmapsDownloadDir,
  searchOnlineBeatmapsets,
  startMirrorBatchJob,
  stopMirrorBatchJob,
} from "../mirrors";

const rulesetSchema = t.Union([
  t.Literal("any"),
  t.Literal("osu"),
  t.Literal("taiko"),
  t.Literal("fruits"),
  t.Literal("mania"),
]);

const statusSchema = t.Union([
  t.Literal("any"),
  t.Literal("ranked"),
  t.Literal("qualified"),
  t.Literal("loved"),
  t.Literal("pending"),
  t.Literal("graveyard"),
]);

const sortSchema = t.Union([
  t.Literal("ranked_desc"),
  t.Literal("ranked_asc"),
  t.Literal("plays_desc"),
  t.Literal("favourites_desc"),
  t.Literal("difficulty_desc"),
  t.Literal("title_asc"),
]);

const batchModeSchema = t.Union([
  t.Literal("pages"),
  t.Literal("query"),
  t.Literal("ids"),
]);

function httpStatusForMirrorError(err: unknown): number {
  if (err instanceof OnlineQueryError) return 400;
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("already running")) return 409;
  if (message.includes("ids must") || message.includes("ids is capped")) {
    return 400;
  }
  if (
    message.includes("No archives") ||
    message.includes("missing on disk") ||
    message.includes("Cannot open archives")
  ) {
    return 400;
  }
  return 502;
}

export const mirrorRoutes = new Elysia({ prefix: "/mirrors" })
  .use(dbPlugin)
  .get("/providers", () => {
    const active = getActiveBeatmapMirrorProvider();
    return {
      active: active.id,
      label: active.label,
      downloadDir: probeBeatmapsDownloadDir(),
      note:
        "Single downloads redirect to a mirror. Batch downloads save .osz files and write import-into-osu.sh / import-into-osu.bat — use Open in osu! or run the script to import into osu!lazer.",
    };
  })
  .get("/download-dir", () => probeBeatmapsDownloadDir())
  .get("/batch", () => getMirrorBatchJobState())
  .post("/batch/stop", () => stopMirrorBatchJob())
  .post("/batch/open-in-osu", async ({ set }) => {
    try {
      return await openLastBatchArchivesInOsu();
    } catch (err) {
      set.status = httpStatusForMirrorError(err);
      return {
        error: err instanceof Error ? err.message : String(err),
      };
    }
  })
  .post(
    "/batch/start",
    ({ db, body, set }) => {
      try {
        const mode = body.mode ?? "pages";
        if (mode === "ids") {
          return startMirrorBatchJob(db, {
            mode: "ids",
            ids: body.ids ?? [],
            noVideo: body.noVideo !== false,
          });
        }
        if (mode === "query") {
          if (body.query == null || body.query.trim() === "") {
            set.status = 400;
            return { error: "query is required for mode=query" };
          }
          return startMirrorBatchJob(db, {
            mode: "query",
            query: body.query,
            sort: body.sort ?? "ranked_desc",
            noVideo: body.noVideo !== false,
            excludeOwned: body.excludeOwned !== false,
            maxPages: body.maxPages,
            maxSets: body.maxSets,
          });
        }
        return startMirrorBatchJob(db, {
          mode: "pages",
          query: body.query,
          q: body.q,
          ruleset: body.ruleset ?? body.searchMode ?? "mania",
          status: body.status ?? "ranked",
          sort: body.sort ?? "ranked_desc",
          startPage: body.startPage ?? 0,
          pageCount: body.pageCount ?? 3,
          noVideo: body.noVideo !== false,
          excludeOwned: body.excludeOwned !== false,
        });
      } catch (err) {
        set.status = httpStatusForMirrorError(err);
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      body: t.Object({
        mode: t.Optional(batchModeSchema),
        query: t.Optional(t.String()),
        q: t.Optional(t.String()),
        /** @deprecated Prefer `ruleset`; kept for older clients. */
        searchMode: t.Optional(rulesetSchema),
        ruleset: t.Optional(rulesetSchema),
        status: t.Optional(statusSchema),
        sort: t.Optional(sortSchema),
        startPage: t.Optional(t.Number()),
        pageCount: t.Optional(t.Number()),
        ids: t.Optional(t.Array(t.Number(), { maxItems: 2000 })),
        maxPages: t.Optional(t.Number()),
        maxSets: t.Optional(t.Number()),
        noVideo: t.Optional(t.Boolean()),
        excludeOwned: t.Optional(t.Boolean()),
      }),
    },
  )
  .get(
    "/search",
    async ({ db, query, set }) => {
      try {
        // Prefer app QL via `query`; fall back to legacy mirror dropdown params.
        if (query.query != null) {
          return await searchOnlineBeatmapsets(db, {
            query: query.query,
            sort: query.sort ?? "ranked_desc",
            page: query.page ?? 0,
            excludeOwned:
              query.excludeOwned !== false && query.excludeOwned !== "0",
          });
        }
        return await searchOnlineBeatmapsets(db, {
          q: query.q,
          mode: query.mode ?? "mania",
          status: query.status ?? "ranked",
          sort: query.sort ?? "ranked_desc",
          page: query.page ?? 0,
          excludeOwned:
            query.excludeOwned !== false && query.excludeOwned !== "0",
        });
      } catch (err) {
        set.status = httpStatusForMirrorError(err);
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      query: t.Object({
        /** App query language (catalog subset). */
        query: t.Optional(t.String()),
        q: t.Optional(t.String()),
        mode: t.Optional(rulesetSchema),
        status: t.Optional(statusSchema),
        sort: t.Optional(sortSchema),
        page: t.Optional(t.Numeric()),
        excludeOwned: t.Optional(
          t.Union([t.Boolean(), t.Literal("1"), t.Literal("0")]),
        ),
      }),
    },
  )
  .post(
    "/missing",
    async ({ db, body, set }) => {
      const ids = [...new Set(body.ids)].filter(
        (id): id is number => parsePositiveSetId(String(id)) != null,
      );
      if (ids.length === 0) {
        set.status = 400;
        return { error: "ids must contain at least one positive beatmapset id" };
      }
      const diff = await diffAgainstLibrary(db, ids);
      return {
        checked: ids.length,
        ...diff,
      };
    },
    {
      body: t.Object({
        ids: t.Array(t.Number(), { minItems: 1, maxItems: 2000 }),
      }),
    },
  )
  .get(
    "/beatmapsets/:setId/download",
    ({ params, query, set }) => {
      const setId = parsePositiveSetId(params.setId);
      if (setId == null) {
        set.status = 400;
        return { error: "Invalid beatmapset id" };
      }

      const provider = getActiveBeatmapMirrorProvider();
      const target = provider.buildDownloadUrl(setId, {
        noVideo: query.noVideo === true || query.noVideo === "1",
      });

      return Response.redirect(target, 302);
    },
    {
      params: t.Object({
        setId: t.String(),
      }),
      query: t.Object({
        noVideo: t.Optional(
          t.Union([t.Boolean(), t.Literal("1"), t.Literal("0")]),
        ),
      }),
    },
  );
