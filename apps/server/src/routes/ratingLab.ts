import { Elysia, t } from "elysia";
import { dbPlugin } from "../db";
import {
  compareManiaRatings,
  compareRowsToCsv,
  ENISSAY_ACCURACY_VERSION,
  getManiaRatingJobState,
  getOrComputeManiaRating,
  getVersion,
  LAZER_MASTER_VERSION,
  listVersions,
  readAllExecutablePaths,
  setExecutablePath,
  startManiaRatingBackfill,
  stopManiaRatingBackfill,
  summarizeManiaRatings,
} from "../mania-rating";
import { QueryParseError } from "../query-language";

export const ratingLabRoutes = new Elysia({ prefix: "/rating-lab" })
  .use(dbPlugin)
  .get("/versions", async ({ db }) => {
    const executables = await readAllExecutablePaths(db);
    return {
      versions: listVersions().map((v) => ({
        id: v.id,
        label: v.label,
        description: v.description,
        gitRef: v.gitRef ?? null,
        executableConfigured: executables[v.id] != null,
        executablePath: executables[v.id],
      })),
      defaults: {
        baseline: LAZER_MASTER_VERSION,
        experiment: ENISSAY_ACCURACY_VERSION,
      },
    };
  })
  .get(
    "/compare",
    async ({ db, query, set }) => {
      const q = query.q?.trim();
      if (!q) {
        set.status = 400;
        return { error: "Query parameter q is required" };
      }

      const baseline = query.baseline ?? LAZER_MASTER_VERSION;
      const experiment = query.experiment ?? ENISSAY_ACCURACY_VERSION;
      const page = Math.max(1, query.page ?? 1);
      const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 48));

      try {
        return compareManiaRatings(db, {
          query: q,
          baselineVersionId: baseline,
          experimentVersionId: experiment,
          page,
          pageSize,
          ensureCompute: query.ensureCompute !== false,
        });
      } catch (err) {
        if (err instanceof QueryParseError) {
          set.status = 400;
          return { error: err.message };
        }
        set.status = 400;
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        baseline: t.Optional(t.String()),
        experiment: t.Optional(t.String()),
        page: t.Optional(t.Number()),
        pageSize: t.Optional(t.Number()),
        ensureCompute: t.Optional(t.Boolean()),
      }),
    },
  )
  .get(
    "/compare/summary",
    async ({ db, query, set }) => {
      const q = query.q?.trim();
      if (!q) {
        set.status = 400;
        return { error: "Query parameter q is required" };
      }

      const baseline = query.baseline ?? LAZER_MASTER_VERSION;
      const experiment = query.experiment ?? ENISSAY_ACCURACY_VERSION;

      try {
        return summarizeManiaRatings(db, {
          query: q,
          baselineVersionId: baseline,
          experimentVersionId: experiment,
          ensureCompute: query.ensureCompute !== false,
        });
      } catch (err) {
        if (err instanceof QueryParseError) {
          set.status = 400;
          return { error: err.message };
        }
        set.status = 400;
        return {
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        baseline: t.Optional(t.String()),
        experiment: t.Optional(t.String()),
        ensureCompute: t.Optional(t.Boolean()),
      }),
    },
  )
  .get(
    "/export",
    async ({ db, query, set }) => {
      const q = query.q?.trim();
      if (!q) {
        set.status = 400;
        return "Query parameter q is required";
      }

      const baseline = query.baseline ?? LAZER_MASTER_VERSION;
      const experiment = query.experiment ?? ENISSAY_ACCURACY_VERSION;

      try {
        const result = compareManiaRatings(db, {
          query: q,
          baselineVersionId: baseline,
          experimentVersionId: experiment,
          page: 1,
          pageSize: 10_000,
          ensureCompute: true,
        });
        set.headers["content-type"] = "text/csv; charset=utf-8";
        set.headers["content-disposition"] =
          'attachment; filename="rating-lab-export.csv"';
        return compareRowsToCsv(result.items);
      } catch (err) {
        set.status = 400;
        return err instanceof Error ? err.message : String(err);
      }
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        baseline: t.Optional(t.String()),
        experiment: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/compute",
    async ({ db, body, set }) => {
      if (!getVersion(body.versionId)) {
        set.status = 400;
        return { error: `Unknown version: ${body.versionId}` };
      }

      const result = await getOrComputeManiaRating(
        db,
        body.beatmapId,
        body.versionId,
        { force: body.force ?? false },
      );

      if (!result) {
        set.status = 404;
        return { error: "Beatmap not found" };
      }

      return result;
    },
    {
      body: t.Object({
        beatmapId: t.String(),
        versionId: t.String(),
        force: t.Optional(t.Boolean()),
      }),
    },
  )
  .get("/job", ({ db }) => getManiaRatingJobState(db))
  .post(
    "/job/start",
    ({ db, body, set }) => {
      if (!getVersion(body.versionId)) {
        set.status = 400;
        return { error: `Unknown version: ${body.versionId}` };
      }
      return startManiaRatingBackfill(db, {
        versionId: body.versionId,
        query: body.query,
      });
    },
    {
      body: t.Object({
        versionId: t.String(),
        query: t.Optional(t.String()),
      }),
    },
  )
  .post("/job/stop", ({ db }) => stopManiaRatingBackfill(db))
  .patch(
    "/executables",
    async ({ db, body, set }) => {
      for (const [versionId, path] of Object.entries(body.executables)) {
        if (!getVersion(versionId)) {
          set.status = 400;
          return { error: `Unknown version: ${versionId}` };
        }
        await setExecutablePath(db, versionId, path);
      }

      const executables = await readAllExecutablePaths(db);
      return {
        executables: Object.fromEntries(
          listVersions().map((v) => [v.id, executables[v.id] ?? null]),
        ),
      };
    },
    {
      body: t.Object({
        executables: t.Record(t.String(), t.Union([t.String(), t.Null()])),
      }),
    },
  );
