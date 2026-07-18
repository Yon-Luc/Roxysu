import { Elysia, t } from "elysia";
import { count, desc, eq, max } from "drizzle-orm";
import { beatmaps, scores } from "@roxysu/db/client.bun";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";

export const beatmapRoutes = new Elysia({ prefix: "/beatmaps" })
  .use(dbPlugin)
  .get(
    "/:id",
    async ({ db, params, set }) => {
      const [beatmap] = await db
        .select()
        .from(beatmaps)
        .where(eq(beatmaps.id, params.id))
        .limit(1);

      if (!beatmap) {
        set.status = 404;
        return { error: "Beatmap not found" };
      }

      const recentScores = await db
        .select()
        .from(scores)
        .where(eq(scores.beatmapId, params.id))
        .orderBy(desc(scores.playedAt))
        .limit(50);

      const [stats] = await db
        .select({
          playCount: count(scores.id),
          bestAccuracy: max(scores.accuracy),
          bestPp: max(scores.pp),
          lastPlayedAt: max(scores.playedAt),
        })
        .from(scores)
        .where(eq(scores.beatmapId, params.id));

      return {
        beatmap: {
          id: beatmap.id,
          onlineId: beatmap.onlineId,
          title: beatmap.title,
          titleUnicode: beatmap.titleUnicode,
          artist: beatmap.artist,
          artistUnicode: beatmap.artistUnicode,
          difficultyName: beatmap.difficultyName,
          starRating: beatmap.starRating,
          bpm: beatmap.bpm,
          length: beatmap.length,
          rulesetShortName: beatmap.rulesetShortName,
          mapperUsername: beatmap.mapperUsername,
          mapperOnlineId: beatmap.mapperOnlineId,
          drainRate: beatmap.drainRate,
          circleSize: beatmap.circleSize,
          overallDifficulty: beatmap.overallDifficulty,
          approachRate: beatmap.approachRate,
          status: beatmap.status,
          lastPlayed: toIso(beatmap.lastPlayed),
        },
        stats: {
          playCount: Number(stats?.playCount ?? 0),
          bestAccuracy: stats?.bestAccuracy ?? null,
          bestPp: stats?.bestPp ?? null,
          lastPlayedAt: toIso(stats?.lastPlayedAt),
        },
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
        })),
        // Phase 5–6 placeholders
        mastery: null,
        notes: [],
        tags: [],
        sessions: [],
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
