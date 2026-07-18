import { Elysia, t } from "elysia";
import { and, count, desc, eq, max } from "drizzle-orm";
import { beatmaps, mastery, scores } from "@roxysu/db/client.bun";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";
import { listSessionsForBeatmap } from "../analytics/session";

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
        .where(
          and(eq(scores.beatmapId, params.id), eq(scores.deletePending, false)),
        )
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
        .where(
          and(eq(scores.beatmapId, params.id), eq(scores.deletePending, false)),
        );

      const [masteryRow] = await db
        .select()
        .from(mastery)
        .where(eq(mastery.beatmapId, params.id))
        .limit(1);

      const sessionRows = await listSessionsForBeatmap(db, params.id);

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
        mastery: masteryRow
          ? {
              level: masteryRow.level,
              playCount: masteryRow.playCount,
              bestAccuracy: masteryRow.bestAccuracy,
              bestPp: masteryRow.bestPp,
              lastPlayedAt: toIso(masteryRow.lastPlayedAt),
              formulaId: masteryRow.formulaId,
              updatedAt: toIso(masteryRow.updatedAt),
            }
          : null,
        notes: [] as Array<{ id: number; body: string }>,
        tags: [] as Array<{ id: number; name: string; color: string | null }>,
        sessions: sessionRows.map((s) => ({
          id: s.id,
          startedAt: toIso(s.startedAt)!,
          endedAt: toIso(s.endedAt),
          scoreCount: s.scoreCount,
          rulesetShortName: s.rulesetShortName,
        })),
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
