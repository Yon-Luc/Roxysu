import { Elysia } from "elysia";
import { count, desc, eq } from "drizzle-orm";
import { beatmaps, imports, scores } from "@roxysu/db/client.bun";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";

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
      })
      .from(scores)
      .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
      .orderBy(desc(scores.playedAt))
      .limit(25);

    const [beatmapCount] = await db.select({ n: count() }).from(beatmaps);
    const [scoreCount] = await db.select({ n: count() }).from(scores);
    const [lastImport] = await db
      .select()
      .from(imports)
      .orderBy(desc(imports.id))
      .limit(1);

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
              error: lastImport.error,
            }
          : null,
      },
      // Phase 5 placeholders
      weeklyActivity: null,
      ppTrend: null,
      accuracyTrend: null,
      currentSession: null,
    };
  });
