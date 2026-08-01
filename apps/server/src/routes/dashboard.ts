import { beatmapDanRatings, beatmapSets, beatmaps, imports, scores } from "@roxysu/db/schema";
import { Elysia } from "elysia";
import { and, count, desc, eq } from "drizzle-orm";

import { dbPlugin } from "../db-runtime";
import { toIso } from "../shared/serialize";
import { getCurrentSession } from "../analytics/session";
import {
  resolveScoresGamemode,
  scoresGamemodeCondition,
} from "../analytics/scoreGamemode";
import {
  resolveScoresUsernames,
  scoresUsernameCondition,
} from "../analytics/scoreUsername";
import {
  getAccuracyTrend,
  getPpTrend,
  getWeeklyActivity,
} from "../analytics/progression";
import { SUNNY_ALGORITHM } from "../map-analysis/computeSunnyDan";
import {
  loadManiaPpCurves,
  resolveScorePp,
} from "../mania-rating/estimateScorePp";

export const dashboardRoutes = new Elysia({ prefix: "/dashboard" })
  .use(dbPlugin)
  .get("/", async ({ db }) => {
    const [usernames, gamemode] = await Promise.all([
      resolveScoresUsernames(db),
      resolveScoresGamemode(db),
    ]);
    const usernameCond = scoresUsernameCondition(usernames);
    const gamemodeCond = scoresGamemodeCondition(gamemode);
    const scoreScope = and(eq(scores.deletePending, false), usernameCond, gamemodeCond);

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
        sunnyEstDiff: beatmapDanRatings.estDiff,
        sunnyStar: beatmapDanRatings.sunnyStar,
      })
      .from(scores)
      .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
      .leftJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
      .leftJoin(
        beatmapDanRatings,
        and(
          eq(beatmapDanRatings.beatmapId, beatmaps.id),
          eq(beatmapDanRatings.algorithm, SUNNY_ALGORITHM),
        ),
      )
      .where(scoreScope)
      .orderBy(desc(scores.playedAt))
      .limit(25);
    const curves = await loadManiaPpCurves(
      db,
      recentScores
        .map((score) => score.beatmapId)
        .filter((beatmapId): beatmapId is string => beatmapId != null),
    );

    const beatmapScope = and(
      eq(beatmaps.hidden, false),
      gamemode ? eq(beatmaps.rulesetShortName, gamemode) : undefined,
    );
    const [beatmapCount] = await db
      .select({ n: count() })
      .from(beatmaps)
      .where(beatmapScope);
    const [scoreCount] = await db
      .select({ n: count() })
      .from(scores)
      .where(scoreScope);
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
        pp: resolveScorePp({
          pp: s.pp,
          accuracy: s.accuracy,
          mods: s.mods,
          rulesetShortName: s.rulesetShortName,
          curve: s.beatmapId ? curves.get(s.beatmapId) : undefined,
        }),
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
        sunnyEstDiff: s.sunnyEstDiff ?? null,
        sunnyStar: s.sunnyStar ?? null,
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
