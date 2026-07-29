import { Elysia, t } from "elysia";
import { dbPlugin } from "../db-runtime";
import {
  getActiveBeatmapMirrorProvider,
  getMirrorBatchJobState,
  parsePositiveSetId,
  probeBeatmapsDownloadDir,
  searchOnlineBeatmapsets,
  startMirrorBatchJob,
  stopMirrorBatchJob,
} from "../mirrors";

const modeSchema = t.Union([
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

export const mirrorRoutes = new Elysia({ prefix: "/mirrors" })
  .use(dbPlugin)
  .get("/providers", () => {
    const active = getActiveBeatmapMirrorProvider();
    return {
      active: active.id,
      label: active.label,
      downloadDir: probeBeatmapsDownloadDir(),
      note:
        "Single downloads redirect to a mirror. Batch downloads save .osz files into the beatmaps folder — open or drag them into osu!lazer to import.",
    };
  })
  .get("/download-dir", () => probeBeatmapsDownloadDir())
  .get("/batch", () => getMirrorBatchJobState())
  .post("/batch/stop", () => stopMirrorBatchJob())
  .post(
    "/batch/start",
    ({ db, body, set }) => {
      try {
        return startMirrorBatchJob(db, {
          q: body.q,
          mode: body.mode ?? "mania",
          status: body.status ?? "ranked",
          sort: body.sort ?? "ranked_desc",
          startPage: body.startPage ?? 0,
          pageCount: body.pageCount ?? 3,
          noVideo: body.noVideo !== false,
          excludeOwned: body.excludeOwned !== false,
        });
      } catch (err) {
        set.status = 409;
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      body: t.Object({
        q: t.Optional(t.String()),
        mode: t.Optional(modeSchema),
        status: t.Optional(statusSchema),
        sort: t.Optional(sortSchema),
        startPage: t.Optional(t.Number()),
        pageCount: t.Optional(t.Number()),
        noVideo: t.Optional(t.Boolean()),
        excludeOwned: t.Optional(t.Boolean()),
      }),
    },
  )
  .get(
    "/search",
    async ({ db, query, set }) => {
      try {
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
        set.status = 502;
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        mode: t.Optional(modeSchema),
        status: t.Optional(statusSchema),
        sort: t.Optional(sortSchema),
        page: t.Optional(t.Numeric()),
        excludeOwned: t.Optional(
          t.Union([t.Boolean(), t.Literal("1"), t.Literal("0")]),
        ),
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

      // Browser follows the mirror redirect / attachment; Roxysu never stores the archive.
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
