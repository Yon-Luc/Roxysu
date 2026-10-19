import { Elysia, status, t } from "elysia";
import { bearer } from "@elysiajs/bearer";
import { eq } from "drizzle-orm";
import { hubUsers } from "@roxysu/db/hub";
import { db } from "../db";
import { jwtPlugin, optionalViewerUserId, requireAuth } from "../middleware/auth";
import {
  importTable,
  ingestBmsBatch,
  listProfileScores,
  listTables,
  profileActivity,
  profileSessions,
  profileStats,
  readBmsProfile,
  readTableVersion,
  tableCompletion,
  type BmsInbound,
} from "../services/bms";
import {
  bmsFeed,
  bmsGlobalStats,
  bmsTimeseries,
  chartLeaderboard,
  compareBmsProfiles,
  readBmsChart,
  readChartScore,
} from "../services/bmsCommunity";

const scoreBody = t.Object({
  localScoreId: t.String(),
  rulesetId: t.Optional(t.String()),
  userId: t.Optional(t.Number()),
  chart: t.Object({
    md5: t.Optional(t.String()),
    sha256: t.Optional(t.Union([t.String(), t.Null()])),
    title: t.Optional(t.Union([t.String(), t.Null()])),
    artist: t.Optional(t.Union([t.String(), t.Null()])),
    keyCount: t.Optional(t.Union([t.Number(), t.Null()])),
  }),
  achievedAt: t.String(),
  score: t.Object({
    exScore: t.Optional(t.Union([t.Number(), t.Null()])),
    maxExScore: t.Optional(t.Union([t.Number(), t.Null()])),
    normalizedScore: t.Optional(t.Union([t.Number(), t.Null()])),
    accuracy: t.Optional(t.Union([t.Number(), t.Null()])),
  }),
  judgements: t.Optional(
    t.Object({
      pgreat: t.Optional(t.Union([t.Number(), t.Null()])),
      great: t.Optional(t.Union([t.Number(), t.Null()])),
      good: t.Optional(t.Union([t.Number(), t.Null()])),
      bad: t.Optional(t.Union([t.Number(), t.Null()])),
      poor: t.Optional(t.Union([t.Number(), t.Null()])),
      miss: t.Optional(t.Union([t.Number(), t.Null()])),
    }),
  ),
  gameplay: t.Object({
    variantId: t.String(),
    gaugeId: t.Optional(t.Union([t.String(), t.Null()])),
    comboLampId: t.Optional(t.Union([t.String(), t.Null()])),
    clearLampId: t.Optional(t.Union([t.String(), t.Null()])),
    djGrade: t.Optional(t.Union([t.String(), t.Null()])),
    mods: t.Optional(t.Array(t.String())),
  }),
});

const notFound = () => status(404, { message: "Not found" });

function reject(set: { status?: number | string }, message: string) {
  set.status = 400;
  return { message };
}

function errorOf(result: object): string | null {
  if ("error" in result && typeof result.error === "string") return result.error;
  return null;
}

export const bmsRoutes = new Elysia()
  .use(jwtPlugin)
  .use(bearer())
  .use(requireAuth)
  .get("/api/me/bms/sync", async ({ user }) => {
    const row = await db.select().from(hubUsers).where(eq(hubUsers.id, user.sub)).get();
    return {
      profilePublic: row?.bmsProfilePublic ?? true,
      countryCode: row?.countryCode ?? null,
    };
  })
  .patch(
    "/api/me/bms/preferences",
    async ({ user, body }) => {
      await db
        .update(hubUsers)
        .set({ bmsProfilePublic: body.profilePublic })
        .where(eq(hubUsers.id, user.sub));
      const row = await db.select().from(hubUsers).where(eq(hubUsers.id, user.sub)).get();
      return { profilePublic: row?.bmsProfilePublic ?? true };
    },
    { body: t.Object({ profilePublic: t.Boolean() }) },
  )
  .post(
    "/api/bms/scores/batch",
    async ({ user, body, set }) => {
      const outcome = await ingestBmsBatch(
        db,
        user.sub,
        body.installationId,
        body.scores as BmsInbound[],
      );
      if (outcome.error) {
        set.status = 400;
        return { message: outcome.error, results: [] };
      }
      return { results: outcome.results };
    },
    {
      body: t.Object({
        installationId: t.String(),
        userId: t.Optional(t.Number()),
        scores: t.Array(scoreBody),
      }),
    },
  )
  .post(
    "/api/bms/tables/import",
    async ({ user, body, set }) => {
      if (user.role !== "admin") return status(403, { message: "Admin access required" });
      try {
        return await importTable(db, body.url);
      } catch (err) {
        set.status = 400;
        return { message: err instanceof Error ? err.message : "import failed" };
      }
    },
    { body: t.Object({ url: t.String() }) },
  );

export const bmsPublicRoutes = new Elysia()
  .use(jwtPlugin)
  .use(bearer())
  .get("/api/bms/tables", async () => listTables(db))
  .get(
    "/api/bms/tables/:tableId/versions/:versionId",
    async ({ params }) => {
      const version = await readTableVersion(db, params.tableId, params.versionId);
      if (!version) return status(404, { message: "Table not found" });
      return version;
    },
  )
  .get("/api/bms/profiles/:username", async ({ params, jwt, bearer }) => {
    const viewer = await optionalViewerUserId(jwt, bearer);
    const profile = await readBmsProfile(db, params.username, viewer ?? null);
    if (!profile) return notFound();
    return profile;
  })
  .get(
    "/api/bms/profiles/:username/scores",
    async ({ params, query, jwt, bearer }) => {
      const viewer = await optionalViewerUserId(jwt, bearer);
      const page = await listProfileScores(db, params.username, viewer ?? null, {
        variant: query.variant ?? null,
        limit: query.limit ?? 20,
        cursor: query.cursor,
      });
      if (!page) return notFound();
      return page;
    },
    {
      query: t.Object({
        variant: t.Optional(t.String()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
        cursor: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/api/bms/profiles/:username/stats",
    async ({ params, query, jwt, bearer, set }) => {
      if (!query.variant) {
        set.status = 400;
        return { message: "variant is required" };
      }
      const viewer = await optionalViewerUserId(jwt, bearer);
      const stats = await profileStats(db, params.username, viewer ?? null, query.variant);
      if (!stats) return notFound();
      return stats;
    },
    { query: t.Object({ variant: t.Optional(t.String()) }) },
  )
  .get(
    "/api/bms/profiles/:username/sessions",
    async ({ params, query, jwt, bearer }) => {
      const viewer = await optionalViewerUserId(jwt, bearer);
      const sessions = await profileSessions(
        db,
        params.username,
        viewer ?? null,
        query.variant ?? null,
      );
      if (!sessions) return notFound();
      return sessions;
    },
    { query: t.Object({ variant: t.Optional(t.String()) }) },
  )
  .get("/api/bms/profiles/:username/activity", async ({ params, jwt, bearer }) => {
    const viewer = await optionalViewerUserId(jwt, bearer);
    const activity = await profileActivity(db, params.username, viewer ?? null);
    if (!activity) return notFound();
    return activity;
  })
  .get(
    "/api/bms/profiles/:username/tables",
    async ({ params, query, jwt, bearer, set }) => {
      if (!query.variant || !query.tableId) {
        set.status = 400;
        return { message: "tableId and variant are required" };
      }
      const viewer = await optionalViewerUserId(jwt, bearer);
      const completion = await tableCompletion(
        db,
        params.username,
        viewer ?? null,
        query.tableId,
        query.versionId ?? null,
        query.variant,
        query.achievement ?? "aa",
      );
      if (!completion) return notFound();
      return completion;
    },
    {
      query: t.Object({
        tableId: t.Optional(t.String()),
        versionId: t.Optional(t.String()),
        variant: t.Optional(t.String()),
        achievement: t.Optional(t.String()),
      }),
    },
  )
  .get("/api/bms/charts/:chartId", async ({ params, set }) => {
    const chart = await readBmsChart(db, params.chartId);
    if (!chart) return status(404, { message: "Chart not found" });
    const chartError = errorOf(chart);
    if (chartError) return reject(set, chartError);
    return chart;
  })
  .get(
    "/api/bms/charts/:chartId/leaderboard",
    async ({ params, query, set }) => {
      const board = await chartLeaderboard(db, params.chartId, {
        variant: query.variant ?? null,
        achievement: query.achievement ?? null,
        gauge: query.gauge ?? null,
        country: query.country ?? null,
        cursor: query.cursor,
        limit: query.limit ?? 20,
      });
      if (!board) return status(404, { message: "Chart not found" });
      const boardError = errorOf(board);
      if (boardError) return reject(set, boardError);
      return board;
    },
    {
      query: t.Object({
        variant: t.Optional(t.String()),
        achievement: t.Optional(t.String()),
        gauge: t.Optional(t.String()),
        country: t.Optional(t.String()),
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
      }),
    },
  )
  .get(
    "/api/bms/charts/:chartId/scores/:scoreId",
    async ({ params, jwt, bearer, set }) => {
      const viewer = await optionalViewerUserId(jwt, bearer);
      const score = await readChartScore(db, params.chartId, params.scoreId, viewer ?? null);
      if (!score) return status(404, { message: "Score not found" });
      const scoreError = errorOf(score);
      if (scoreError) return reject(set, scoreError);
      return score;
    },
  )
  .get(
    "/api/bms/compare/:playerA/:playerB",
    async ({ params, query, jwt, bearer, set }) => {
      const viewer = await optionalViewerUserId(jwt, bearer);
      const compared = await compareBmsProfiles(db, params.playerA, params.playerB, viewer ?? null, {
        variant: query.variant ?? null,
        tableId: query.tableId ?? null,
        achievement: query.achievement ?? null,
      });
      if (!compared) return notFound();
      const comparedError = errorOf(compared);
      if (comparedError) return reject(set, comparedError);
      return compared;
    },
    {
      query: t.Object({
        variant: t.Optional(t.String()),
        tableId: t.Optional(t.String()),
        achievement: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/api/bms/feed",
    async ({ query, set }) => {
      const feed = await bmsFeed(db, { cursor: query.cursor, limit: query.limit ?? 20 });
      const feedError = errorOf(feed);
      if (feedError) return reject(set, feedError);
      return feed;
    },
    {
      query: t.Object({
        cursor: t.Optional(t.String()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 50 })),
      }),
    },
  )
  .get("/api/bms/stats", async () => bmsGlobalStats(db))
  .get(
    "/api/bms/stats/timeseries",
    async ({ query, set }) => {
      const series = await bmsTimeseries(db, {
        from: query.from,
        to: query.to,
        interval: query.interval,
      });
      const seriesError = errorOf(series);
      if (seriesError) return reject(set, seriesError);
      return series;
    },
    {
      query: t.Object({
        from: t.Optional(t.String()),
        to: t.Optional(t.String()),
        interval: t.Optional(t.String()),
      }),
    },
  );
