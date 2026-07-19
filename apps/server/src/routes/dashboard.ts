import { Elysia } from "elysia";
import { count, desc, eq } from "drizzle-orm";
import { beatmaps, beatmapSets, imports, scores } from "@roxysu/db/client.bun";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";
import { getCurrentSession } from "../analytics/session";
import {
  getAccuracyTrend,
  getPpTrend,
  getWeeklyActivity,
} from "../analytics/progression";

export const dashboardRoutes = new Elysia({ prefix: "/dashboard" })
  .use(dbPlugin)
  .get("/", async ({ db }) => {
    const recentScores = await db
      .select({
        id: scores.id,
        accuracy: scores.accuracy,
        pp: scores.pp,
        maxCombo: scores.maxCombo,
        mods: scores.mods,
        rank: scores.rank,
        totalScore: scores.totalScore,
        rulesetShortName: scores.rulesetShortName,
        playedAt: scores.playedAt,
        beatmapId: scores.beatmapId,
        title: beatmaps.title,
        artist: beatmaps.artist,
        difficultyName: beatmaps.difficultyName,
        starRating: beatmaps.starRating,
        setOnlineId: beatmapSets.onlineId,
        backgroundFileHash: beatmaps.backgroundFileHash,
      })
      .from(scores)
      .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
      .leftJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
      .where(eq(scores.deletePending, false))
      .orderBy(desc(scores.playedAt))
      .limit(25);

    const [beatmapCount] = await db.select({ n: count() }).from(beatmaps);
    const [scoreCount] = await db
      .select({ n: count() })
      .from(scores)
      .where(eq(scores.deletePending, false));
    const [lastImport] = await db
      .select()
      .from(imports)
      .orderBy(desc(imports.id))
      .limit(1);

    const current = await getCurrentSession(db);
    const [weeklyActivity, ppTrend, accuracyTrend] = await Promise.all([
      getWeeklyActivity(db, 12),
      getPpTrend(db, 30),
      getAccuracyTrend(db, 30),
    ]);

    return {
      recentScores: recentScores.map((s) => ({
        id: s.id,
        accuracy: s.accuracy,
        pp: s.pp,
        maxCombo: s.maxCombo,
        mods: s.mods,
        rank: s.rank,
        totalScore: s.totalScore,
        rulesetShortName: s.rulesetShortName,
        playedAt: toIso(s.playedAt),
        beatmapId: s.beatmapId,
        title: s.title,
        artist: s.artist,
        difficultyName: s.difficultyName,
        starRating: s.starRating,
        setOnlineId:
          s.setOnlineId != null && s.setOnlineId > 0 ? s.setOnlineId : null,
        backgroundFileHash: s.backgroundFileHash,
      })),
      sync: {
        beatmapCount: beatmapCount?.n ?? 0,
        scoreCount: scoreCount?.n ?? 0,
        lastImport: lastImport
          ? {
              id: lastImport.id,
              kind: lastImport.kind,
              status: lastImport.status,
              startedAt: toIso(lastImport.startedAt),
              finishedAt: toIso(lastImport.finishedAt),
              beatmapsUpserted: lastImport.beatmapsUpserted,
              scoresUpserted: lastImport.scoresUpserted,
              rowsChanged: lastImport.rowsChanged,
              error: lastImport.error,
            }
          : null,
      },
      weeklyActivity,
      ppTrend,
      accuracyTrend,
      currentSession: current
        ? {
            id: current.id,
            startedAt: toIso(current.startedAt),
            endedAt: toIso(current.endedAt),
            scoreCount: current.scoreCount,
            rulesetShortName: current.rulesetShortName,
          }
        : null,
    };
  });
