import { beatmapSets, beatmaps, imports, scores } from "@roxysu/db/schema";
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
import { getWeeklyActivity } from "../analytics/progression";
import { getPracticeSnapshot } from "../analytics/practiceSnapshot";
import { REWORK_ALGORITHM } from "../map-analysis/reworkEstimator";
import {
  danVariantKey,
  resolveDanVariant,
} from "../replay/mods";
import { loadDanVariantRatingsSync } from "../map-analysis/computeDanVariants";
import {
  reworkEstDiffSelect,
  reworkLnRatioSelect,
  reworkStarSelect,
} from "../map-analysis/danRatingSelect";
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
        keyCount: beatmaps.circleSize,
        setOnlineId: beatmapSets.onlineId,
        backgroundFileHash: beatmaps.backgroundFileHash,
        reworkEstDiff: reworkEstDiffSelect(),
        reworkStar: reworkStarSelect(),
        reworkLnRatio: reworkLnRatioSelect(),
      })
      .from(scores)
      .leftJoin(beatmaps, eq(scores.beatmapId, beatmaps.id))
      .leftJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
      .where(scoreScope)
      .orderBy(desc(scores.playedAt))
      .limit(8);

    const beatmapScope = and(
      eq(beatmaps.hidden, false),
      gamemode ? eq(beatmaps.rulesetShortName, gamemode) : undefined,
    );
    const recentBeatmapIds = recentScores
      .map((score) => score.beatmapId)
      .filter((beatmapId): beatmapId is string => beatmapId != null);

    const [
      curves,
      [beatmapCount],
      [scoreCount],
      [lastImport],
      current,
      weeklyActivity,
      practiceSnapshot,
    ] = await Promise.all([
      loadManiaPpCurves(db, recentBeatmapIds),
      db.select({ n: count() }).from(beatmaps).where(beatmapScope),
      db.select({ n: count() }).from(scores).where(scoreScope),
      db.select().from(imports).orderBy(desc(imports.id)).limit(1),
      getCurrentSession(db),
      getWeeklyActivity(db, 12),
      getPracticeSnapshot(db),
    ]);

    // Modded plays show their rework difficulty variant labels when computed.
    const ratedIds = [...new Set(recentBeatmapIds)];
    const reworkVariants = loadDanVariantRatingsSync(db, ratedIds, REWORK_ALGORITHM);

    return {
      recentScores: recentScores.map((s) => {
        let reworkEstDiff = s.reworkEstDiff ?? null;
        let reworkStar = s.reworkStar != null ? Number(s.reworkStar) : null;
        let reworkLnRatio =
          s.reworkLnRatio != null ? Number(s.reworkLnRatio) : null;
        if (s.beatmapId) {
          const variant = resolveDanVariant(s.mods);
          if (variant) {
            const reworkVariant = reworkVariants.get(
              danVariantKey(s.beatmapId, variant),
            );
            if (reworkVariant) {
              reworkEstDiff = reworkVariant.estDiff;
              reworkStar = reworkVariant.star;
              reworkLnRatio = reworkVariant.lnRatio ?? reworkLnRatio;
            }
          }
        }
        return {
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
        keyCount: s.keyCount != null ? Math.round(Number(s.keyCount)) : null,
        reworkEstDiff,
        reworkStar,
        reworkLnRatio,
        setOnlineId:
          s.setOnlineId != null && s.setOnlineId > 0 ? s.setOnlineId : null,
        backgroundFileHash: s.backgroundFileHash,
        };
      }),
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
      practiceSnapshot,
      currentSession: current
        ? {
            id: current.id,
            name: current.name,
            startedAt: toIso(current.startedAt),
            endedAt: toIso(current.endedAt),
            scoreCount: current.scoreCount,
            rulesetShortName: current.rulesetShortName,
          }
        : null,
    };
  });
