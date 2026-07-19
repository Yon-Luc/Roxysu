import { Elysia, t } from "elysia";
import { and, count, desc, eq, max } from "drizzle-orm";
import { beatmaps, beatmapSets, mastery, scores } from "@roxysu/db/client.bun";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";
import { listSessionsForBeatmap } from "../analytics/session";
import { getOrComputeSunnyDan } from "../map-analysis/computeSunnyDan";

export const beatmapRoutes = new Elysia({ prefix: "/beatmaps" })
  .use(dbPlugin)
  .get(
    "/:id",
    async ({ db, params, set }) => {
      const [row] = await db
        .select({
          beatmap: beatmaps,
          setOnlineId: beatmapSets.onlineId,
        })
        .from(beatmaps)
        .leftJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
        .where(eq(beatmaps.id, params.id))
        .limit(1);

      if (!row) {
        set.status = 404;
        return { error: "Beatmap not found" };
      }

      const { beatmap, setOnlineId } = row;

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
      const sunnyDan =
        beatmap.rulesetShortName === "mania"
          ? await getOrComputeSunnyDan(db, params.id)
          : null;

      return {
        beatmap: {
          id: beatmap.id,
          onlineId: beatmap.onlineId,
          setOnlineId: setOnlineId ?? null,
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
          backgroundFileHash: beatmap.backgroundFileHash,
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
        sunnyDan,
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
  )
  .post(
    "/:id/sunny-dan",
    async ({ db, params, set }) => {
      const [beatmap] = await db
        .select({
          id: beatmaps.id,
          rulesetShortName: beatmaps.rulesetShortName,
        })
        .from(beatmaps)
        .where(eq(beatmaps.id, params.id))
        .limit(1);

      if (!beatmap) {
        set.status = 404;
        return { error: "Beatmap not found" };
      }

      if (beatmap.rulesetShortName !== "mania") {
        set.status = 400;
        return { error: "Sunny dan is only available for mania maps" };
      }

      const sunnyDan = await getOrComputeSunnyDan(db, params.id, {
        force: true,
      });
      return { sunnyDan };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
