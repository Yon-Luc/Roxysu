import { Elysia, t } from "elysia";
import { readFileSync } from "node:fs";
import { dbPlugin } from "../db-runtime";
import { toIso } from "../shared/serialize";
import {
  getOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import type { StdHitObject } from "@roxysu/osu-chart";
import {
  decodeLegacyReplay,
  isManiaRulesetId,
  isOsuRulesetId,
} from "../replay/decode";
import { simulateManiaJudgments } from "../replay/judge";
import { parseScoreMods } from "../replay/mods";
import { getScoreRow, loadChartForScore } from "../replay/loadChart";
import { loadStdChartForScore } from "../replay/loadStdChart";
import {
  adjustStdDifficulty,
  applyStdHardRockFlip,
  simulateStdJudgments,
} from "../replay/stdJudge";
import {
  loadManiaPpCurves,
  resolveScorePp,
} from "../mania-rating/estimateScorePp";

const EMPTY_HIT_OBJECTS: StdHitObject[] = [];
const EMPTY_NOTES: Array<{ column: number; startMs: number; endMs: number }> =
  [];
const EMPTY_MANIA_FRAMES: Array<{ tMs: number; keys: number }> = [];
const EMPTY_STD_FRAMES: Array<{
  tMs: number;
  x: number;
  y: number;
  buttons: number;
}> = [];

export const scoreRoutes = new Elysia({ prefix: "/scores" })
  .use(dbPlugin)
  .get(
    "/:id/replay",
    async ({ db, params, set }) => {
      const score = await getScoreRow(db, params.id);
      if (!score) {
        set.status = 404;
        return { error: "Score not found" };
      }
      const curves = await loadManiaPpCurves(
        db,
        score.beatmapId ? [score.beatmapId] : [],
      );

      const isMania = score.rulesetShortName === "mania";
      const isStd = score.rulesetShortName === "osu";
      if (!isMania && !isStd) {
        set.status = 422;
        return { error: "Replay rewatch supports mania and standard only" };
      }

      if (!score.replayFileHash) {
        set.status = 404;
        return { error: "No local replay for this score" };
      }

      const replayPath = resolveLazerFilePath(
        score.replayFileHash,
        getOsuDataPath(),
      );
      if (!replayPath) {
        set.status = 404;
        return { error: "Could not resolve replay file" };
      }

      let replayBytes: Buffer;
      try {
        replayBytes = readFileSync(replayPath);
      } catch {
        set.status = 404;
        return { error: "Replay file missing from lazer files store" };
      }

      let decoded;
      try {
        decoded = await decodeLegacyReplay(replayBytes);
      } catch (err) {
        set.status = 422;
        return {
          error:
            err instanceof Error
              ? `Failed to decode replay: ${err.message}`
              : "Failed to decode replay",
        };
      }

      const scorePayload = {
        id: score.id,
        beatmapId: score.beatmapId,
        accuracy: score.accuracy,
        maxCombo: score.maxCombo,
        pp: resolveScorePp({
          pp: score.pp,
          accuracy: score.accuracy,
          mods: score.mods,
          rulesetShortName: score.rulesetShortName,
          curve: score.beatmapId ? curves.get(score.beatmapId) : undefined,
        }),
        rank: score.rank,
        totalScore: score.totalScore,
        mods: score.mods,
        rulesetShortName: score.rulesetShortName,
        playedAt: toIso(score.playedAt),
        userUsername: score.userUsername,
        replayFileHash: score.replayFileHash,
      };

      if (isStd) {
        if (!isOsuRulesetId(decoded.rulesetId)) {
          set.status = 422;
          return { error: "Replay is not standard" };
        }

        const chartResult = await loadStdChartForScore(db, score);
        if (!chartResult.ok) {
          set.status = chartResult.status;
          return { error: chartResult.error };
        }
        const { chart } = chartResult;
        const mods = parseScoreMods(score.mods);
        const diff = adjustStdDifficulty(
          {
            cs: chart.circleSize,
            ar: chart.approachRate,
            od: chart.overallDifficulty,
          },
          mods,
        );
        const flipped = applyStdHardRockFlip(
          chart.hitObjects,
          decoded.stdFrames,
          mods.hardRock,
        );
        const { judgments, summary } = simulateStdJudgments({
          hitObjects: flipped.hitObjects,
          frames: flipped.frames,
          circleSize: chart.circleSize,
          overallDifficulty: chart.overallDifficulty,
          mods,
        });

        return {
          score: scorePayload,
          beatmap: {
            id: chart.beatmapId,
            title: chart.title,
            artist: chart.artist,
            difficultyName: chart.difficultyName,
            setOnlineId: chart.setOnlineId,
            rulesetShortName: chart.rulesetShortName,
            overallDifficulty: diff.od,
            circleSize: diff.cs,
            approachRate: diff.ar,
            previewTime: chart.previewTime,
            audioFileHash: chart.audioFileHash,
            backgroundFileHash: chart.backgroundFileHash,
            lengthMs: chart.lengthMs,
            columnCount: 0,
            notes: EMPTY_NOTES,
            hitObjects: flipped.hitObjects,
          },
          playback: {
            rate: mods.rate,
            mirror: false,
            acronyms: mods.acronyms,
          },
          frames: EMPTY_MANIA_FRAMES,
          stdFrames: flipped.frames,
          judgments,
          simulated: summary,
        };
      }

      if (!isManiaRulesetId(decoded.rulesetId)) {
        set.status = 422;
        return { error: "Replay is not mania" };
      }

      const chartResult = await loadChartForScore(db, score);
      if (!chartResult.ok) {
        set.status = chartResult.status;
        return { error: chartResult.error };
      }
      const { chart } = chartResult;
      const mods = parseScoreMods(score.mods);
      const { judgments, summary } = simulateManiaJudgments({
        notes: chart.notes,
        frames: decoded.frames,
        columnCount: chart.columnCount,
        overallDifficulty: chart.overallDifficulty,
        mods,
      });

      const displayNotes = mods.mirror
        ? chart.notes.map((n) => ({
            ...n,
            column: chart.columnCount - 1 - n.column,
          }))
        : chart.notes;

      return {
        score: scorePayload,
        beatmap: {
          id: chart.beatmapId,
          title: chart.title,
          artist: chart.artist,
          difficultyName: chart.difficultyName,
          setOnlineId: chart.setOnlineId,
          rulesetShortName: chart.rulesetShortName,
          overallDifficulty: chart.overallDifficulty,
          circleSize: 0,
          approachRate: 0,
          previewTime: chart.previewTime,
          audioFileHash: chart.audioFileHash,
          backgroundFileHash: chart.backgroundFileHash,
          lengthMs: chart.lengthMs,
          columnCount: chart.columnCount,
          notes: displayNotes,
          hitObjects: EMPTY_HIT_OBJECTS,
        },
        playback: {
          rate: mods.rate,
          mirror: mods.mirror,
          acronyms: mods.acronyms,
        },
        frames: decoded.frames,
        stdFrames: EMPTY_STD_FRAMES,
        judgments,
        simulated: summary,
      };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
    },
  );
