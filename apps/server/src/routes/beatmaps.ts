import { beatmapSets, beatmaps, mastery, scores } from "@roxysu/db/schema";
import { Elysia, t } from "elysia";
import { readFileSync } from "node:fs";
import { and, count, desc, eq, max } from "drizzle-orm";

import { dbPlugin } from "../db-runtime";
import { toIso } from "../shared/serialize";
import { listSessionsForBeatmap } from "../analytics/session";
import {
  resolveScoresGamemode,
  scoresGamemodeCondition,
} from "../analytics/scoreGamemode";
import {
  resolveScoresUsernames,
  scoresUsernameCondition,
} from "../analytics/scoreUsername";
import {
  getOrComputeSunnyDan,
  getSunnyDanForPatternMods,
} from "../map-analysis/computeSunnyDan";
import { getOrComputeDanielDan } from "../map-analysis/computeDanielDan";
import {
  getOrComputePatternAnalysis,
  analyzeManiaPatternDetail,
  getManiaPatternDetail,
} from "../map-analysis/computePatternAnalysis";
import {
  loadBeatmapOsu,
  chartTimingFromOsuText,
  getChartTimingAnalysis,
} from "../map-analysis/computeTimingAnalysis";
import {
  OsuFileParser,
  parseCatchChart,
  parseStdChart,
  parseTaikoChart,
} from "@roxysu/osu-chart";
import { parsePatternModQuery } from "../replay/mods";
import { applyManiaPatternMods } from "../replay/loadChart";
import {
  getOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import {
  buildDifficultyOsz,
  buildSetOszForBeatmap,
  isOszBuildError,
  oszContentDisposition,
} from "../map-analysis/exportOsz";
import {
  loadManiaPpCurves,
  resolveScorePp,
} from "../mania-rating/estimateScorePp";

function oszResponse(pack: {
  bytes: Uint8Array;
  filename: string;
}): Response {
  return new Response(Buffer.from(pack.bytes), {
    headers: {
      "content-type": "application/x-osu-beatmap-archive",
      "content-disposition": oszContentDisposition(pack.filename),
      "cache-control": "no-store",
    },
  });
}

export const beatmapRoutes = new Elysia({ prefix: "/beatmaps" })
  .use(dbPlugin)
  .get(
    "/:id/stats",
    async ({ db, params, set }) => {
      const [row] = await db
        .select({ id: beatmaps.id })
        .from(beatmaps)
        .where(eq(beatmaps.id, params.id))
        .limit(1);
      if (!row) {
        set.status = 404;
        return { error: "Beatmap not found" };
      }

      const [usernames, gamemode] = await Promise.all([
        resolveScoresUsernames(db),
        resolveScoresGamemode(db),
      ]);
      const usernameCond = scoresUsernameCondition(usernames);
      const gamemodeCond = scoresGamemodeCondition(gamemode);
      const scoreScope = and(
        eq(scores.beatmapId, params.id),
        eq(scores.deletePending, false),
        usernameCond,
        gamemodeCond,
      );

      const [stats] = await db
        .select({
          playCount: count(scores.id),
          bestAccuracy: max(scores.accuracy),
          lastPlayedAt: max(scores.playedAt),
        })
        .from(scores)
        .where(scoreScope);

      const scorePpRows = await db
        .select({
          pp: scores.pp,
          accuracy: scores.accuracy,
          mods: scores.mods,
          rulesetShortName: scores.rulesetShortName,
        })
        .from(scores)
        .where(scoreScope);
      const curves = await loadManiaPpCurves(db, [params.id]);
      const curve = curves.get(params.id);
      const bestPp = scorePpRows.reduce<number | null>((best, score) => {
        const pp = resolveScorePp({
          ...score,
          curve,
        });
        return pp != null && (best == null || pp > best) ? pp : best;
      }, null);

      return {
        playCount: Number(stats?.playCount ?? 0),
        bestAccuracy: stats?.bestAccuracy ?? null,
        bestPp,
        lastPlayedAt: toIso(stats?.lastPlayedAt),
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )
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
      const [usernames, gamemode] = await Promise.all([
        resolveScoresUsernames(db),
        resolveScoresGamemode(db),
      ]);
      const usernameCond = scoresUsernameCondition(usernames);
      const gamemodeCond = scoresGamemodeCondition(gamemode);
      const scoreScope = and(
        eq(scores.beatmapId, params.id),
        eq(scores.deletePending, false),
        usernameCond,
        gamemodeCond,
      );

      const isMania = beatmap.rulesetShortName === "mania";
      const is4kMania =
        isMania &&
        beatmap.circleSize != null &&
        Math.round(beatmap.circleSize) === 4;

      const [
        recentScores,
        statsRows,
        scorePpRows,
        curves,
        masteryRows,
        sessionRows,
        sunnyDan,
        danielDan,
        patternAnalysis,
        osuLoaded,
      ] = await Promise.all([
        db
          .select({
            id: scores.id,
            accuracy: scores.accuracy,
            pp: scores.pp,
            maxCombo: scores.maxCombo,
            mods: scores.mods,
            rank: scores.rank,
            totalScore: scores.totalScore,
            rulesetShortName: scores.rulesetShortName,
            replayFileHash: scores.replayFileHash,
            playedAt: scores.playedAt,
          })
          .from(scores)
          .where(scoreScope)
          .orderBy(desc(scores.playedAt))
          .limit(50),
        db
          .select({
            playCount: count(scores.id),
            bestAccuracy: max(scores.accuracy),
            lastPlayedAt: max(scores.playedAt),
          })
          .from(scores)
          .where(scoreScope),
        db
          .select({
            pp: scores.pp,
            accuracy: scores.accuracy,
            mods: scores.mods,
            rulesetShortName: scores.rulesetShortName,
          })
          .from(scores)
          .where(scoreScope),
        loadManiaPpCurves(db, [params.id]),
        db
          .select()
          .from(mastery)
          .where(eq(mastery.beatmapId, params.id))
          .limit(1),
        listSessionsForBeatmap(db, params.id, 24),
        isMania ? getOrComputeSunnyDan(db, params.id) : Promise.resolve(null),
        is4kMania
          ? getOrComputeDanielDan(db, params.id)
          : Promise.resolve(null),
        isMania
          ? getOrComputePatternAnalysis(db, params.id)
          : Promise.resolve(null),
        isMania ? loadBeatmapOsu(db, params.id) : Promise.resolve(null),
      ]);

      const [stats] = statsRows;
      const [masteryRow] = masteryRows;
      const curve = curves.get(params.id);
      const resolvePp = (score: {
        pp: number | null;
        accuracy: number;
        mods: string | null;
        rulesetShortName: string | null;
      }) =>
        resolveScorePp({
          ...score,
          curve,
        });
      const bestPp = scorePpRows.reduce<number | null>((best, score) => {
        const pp = resolvePp(score);
        return pp != null && (best == null || pp > best) ? pp : best;
      }, null);

      let sevenKAnalysis = null;
      let timingAnalysis = null;
      if (osuLoaded?.ok) {
        try {
          sevenKAnalysis = analyzeManiaPatternDetail(osuLoaded.osuText);
        } catch {
          sevenKAnalysis = await getManiaPatternDetail(db, params.id);
        }
        try {
          timingAnalysis = chartTimingFromOsuText(osuLoaded.osuText);
        } catch {
          timingAnalysis = await getChartTimingAnalysis(db, params.id);
        }
      } else if (isMania) {
        sevenKAnalysis = await getManiaPatternDetail(db, params.id);
        timingAnalysis = await getChartTimingAnalysis(db, params.id);
      }

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
          previewTime: beatmap.previewTime,
          audioFileHash: beatmap.audioFileHash,
          backgroundFileHash: beatmap.backgroundFileHash,
        },
        stats: {
          playCount: Number(stats?.playCount ?? 0),
          bestAccuracy: stats?.bestAccuracy ?? null,
          bestPp,
          lastPlayedAt: toIso(stats?.lastPlayedAt),
        },
        recentScores: recentScores.map((s) => ({
          id: s.id,
          accuracy: s.accuracy,
          pp: resolvePp(s),
          maxCombo: s.maxCombo,
          mods: s.mods,
          rank: s.rank,
          totalScore: s.totalScore,
          rulesetShortName: s.rulesetShortName,
          hasReplay: Boolean(s.replayFileHash),
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
        danielDan,
        patternAnalysis,
        sevenKAnalysis,
        timingAnalysis,
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
  .get(
    "/:id/preview",
    async ({ db, params, query, set }) => {
      const patternMods = parsePatternModQuery(query?.mods);

      const [row] = await db
        .select({
          id: beatmaps.id,
          hash: beatmaps.hash,
          rulesetShortName: beatmaps.rulesetShortName,
          previewTime: beatmaps.previewTime,
          audioFileHash: beatmaps.audioFileHash,
          backgroundFileHash: beatmaps.backgroundFileHash,
          title: beatmaps.title,
          artist: beatmaps.artist,
          difficultyName: beatmaps.difficultyName,
          overallDifficulty: beatmaps.overallDifficulty,
          circleSize: beatmaps.circleSize,
          approachRate: beatmaps.approachRate,
          setOnlineId: beatmapSets.onlineId,
          length: beatmaps.length,
        })
        .from(beatmaps)
        .leftJoin(beatmapSets, eq(beatmaps.setId, beatmapSets.id))
        .where(eq(beatmaps.id, params.id))
        .limit(1);

      if (!row) {
        set.status = 404;
        return { error: "Beatmap not found" };
      }

      const base = {
        id: row.id,
        title: row.title,
        artist: row.artist,
        difficultyName: row.difficultyName,
        setOnlineId: row.setOnlineId ?? null,
        rulesetShortName: row.rulesetShortName,
        previewTime: row.previewTime,
        audioFileHash: row.audioFileHash,
        backgroundFileHash: row.backgroundFileHash,
        lengthMs: Math.round(row.length ?? 0),
        overallDifficulty: row.overallDifficulty ?? 0,
        circleSize: row.circleSize ?? 5,
        approachRate: row.approachRate ?? row.overallDifficulty ?? 5,
        supported: false as boolean,
        columnCount: 0,
        appliedMods: [] as string[],
        notes: [] as Array<{ column: number; startMs: number; endMs: number }>,
        hitObjects: [] as ReturnType<typeof parseStdChart>["hitObjects"],
        taikoHitObjects: [] as ReturnType<typeof parseTaikoChart>["hitObjects"],
        catchHitObjects: [] as ReturnType<typeof parseCatchChart>["hitObjects"],
      };

      const isMania = row.rulesetShortName === "mania";
      const isStd = row.rulesetShortName === "osu";
      const isTaiko = row.rulesetShortName === "taiko";
      const isCatch = row.rulesetShortName === "fruits";
      if (!isMania && !isStd && !isTaiko && !isCatch) {
        return { ...base, supported: false };
      }

      if (!row.hash) {
        set.status = 404;
        return { error: "Beatmap file hash missing" };
      }

      const filePath = resolveLazerFilePath(row.hash, getOsuDataPath());
      if (!filePath) {
        set.status = 404;
        return { error: "Could not resolve beatmap file" };
      }

      let osuText: string;
      try {
        osuText = readFileSync(filePath, "utf8");
      } catch {
        set.status = 404;
        return { error: "Beatmap file not found in lazer files store" };
      }

      if (isStd) {
        const chart = parseStdChart(osuText);
        if (chart.status === "NotStd") {
          return { ...base, supported: false };
        }
        if (chart.status === "Fail" || chart.hitObjects.length === 0) {
          set.status = 422;
          return { error: "Failed to parse beatmap" };
        }
        return {
          ...base,
          supported: true,
          circleSize: chart.circleSize,
          approachRate: chart.approachRate,
          overallDifficulty: chart.overallDifficulty,
          hitObjects: chart.hitObjects,
        };
      }

      if (isTaiko) {
        const chart = parseTaikoChart(osuText);
        if (chart.status === "NotTaiko") {
          return { ...base, supported: false };
        }
        if (chart.status === "Fail" || chart.hitObjects.length === 0) {
          set.status = 422;
          return { error: "Failed to parse beatmap" };
        }
        return {
          ...base,
          supported: true,
          circleSize: chart.circleSize,
          approachRate: chart.approachRate,
          overallDifficulty: chart.overallDifficulty,
          taikoHitObjects: chart.hitObjects,
        };
      }

      if (isCatch) {
        const chart = parseCatchChart(osuText);
        if (chart.status === "NotCatch") {
          return { ...base, supported: false };
        }
        if (chart.status === "Fail" || chart.hitObjects.length === 0) {
          set.status = 422;
          return { error: "Failed to parse beatmap" };
        }
        return {
          ...base,
          supported: true,
          circleSize: chart.circleSize,
          approachRate: chart.approachRate,
          overallDifficulty: chart.overallDifficulty,
          catchHitObjects: chart.hitObjects,
        };
      }

      const parser = new OsuFileParser(osuText);
      parser.process();

      if (parser.status === "NotMania" || parser.gameMode !== "3") {
        return { ...base, supported: false };
      }

      if (parser.status === "Fail" || parser.columnCount <= 0) {
        set.status = 422;
        return { error: "Failed to parse beatmap" };
      }

      // Lazer pattern-conversion mods: Invert then Hold Off, Mirror flips
      // columns on the finished conversion.
      applyManiaPatternMods(parser, patternMods);

      const notes: Array<{ column: number; startMs: number; endMs: number }> =
        [];
      for (let i = 0; i < parser.noteStarts.length; i += 1) {
        const column = patternMods.mirror
          ? parser.columnCount - 1 - parser.columns[i]!
          : parser.columns[i]!;
        notes.push({
          column,
          startMs: parser.noteStarts[i]!,
          endMs: parser.noteEnds[i]!,
        });
      }
      notes.sort((a, b) => a.startMs - b.startMs || a.column - b.column);

      return {
        ...base,
        supported: true,
        columnCount: parser.columnCount,
        appliedMods: patternMods.acronyms,
        notes,
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        mods: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/:id/export",
    async ({ db, params, set }) => {
      const pack = await buildDifficultyOsz(db, params.id);
      if (isOszBuildError(pack)) {
        set.status = pack.status;
        return { error: pack.error };
      }
      return oszResponse(pack);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )
  .get(
    "/:id/export-set",
    async ({ db, params, set }) => {
      const pack = await buildSetOszForBeatmap(db, params.id);
      if (isOszBuildError(pack)) {
        set.status = pack.status;
        return { error: pack.error };
      }
      return oszResponse(pack);
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  )
  .get(
    "/:id/sunny-dan",
    async ({ db, params, query, set }) => {
      const patternMods = parsePatternModQuery(query?.mods);
      const rawRate = Number(query?.rate);
      // Modal rate presets run 0.5–1.5; keep a little headroom either way.
      const speedRate =
        Number.isFinite(rawRate) && rawRate > 0
          ? Math.min(3, Math.max(0.5, rawRate))
          : 1;

      const sunnyDan = await getSunnyDanForPatternMods(db, params.id, {
        invert: patternMods.invert,
        holdOff: patternMods.holdOff,
        speedRate,
      });

      if (!sunnyDan) {
        set.status = 404;
        return { error: "Beatmap not found" };
      }
      return { sunnyDan };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      query: t.Object({
        mods: t.Optional(t.String()),
        rate: t.Optional(t.String()),
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
