import { Elysia, t } from "elysia";
import { readFileSync } from "node:fs";
import { dbPlugin } from "../db";
import { toIso } from "../shared/serialize";
import {
  defaultOsuDataPath,
  resolveLazerFilePath,
} from "../shared/lazer-files";
import { decodeLegacyReplay, isManiaRulesetId } from "../replay/decode";
import { simulateManiaJudgments } from "../replay/judge";
import { parseScoreMods } from "../replay/mods";
import { getScoreRow, loadChartForScore } from "../replay/loadChart";

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

      if (score.rulesetShortName !== "mania") {
        set.status = 422;
        return { error: "Replay rewatch is mania-only" };
      }

      if (!score.replayFileHash) {
        set.status = 404;
        return { error: "No local replay for this score" };
      }

      const replayPath = resolveLazerFilePath(
        score.replayFileHash,
        defaultOsuDataPath(),
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
        score: {
          id: score.id,
          beatmapId: score.beatmapId,
          accuracy: score.accuracy,
          maxCombo: score.maxCombo,
          pp: score.pp,
          rank: score.rank,
          totalScore: score.totalScore,
          mods: score.mods,
          rulesetShortName: score.rulesetShortName,
          playedAt: toIso(score.playedAt),
          userUsername: score.userUsername,
          replayFileHash: score.replayFileHash,
        },
        beatmap: {
          id: chart.beatmapId,
          title: chart.title,
          artist: chart.artist,
          difficultyName: chart.difficultyName,
          setOnlineId: chart.setOnlineId,
          rulesetShortName: chart.rulesetShortName,
          overallDifficulty: chart.overallDifficulty,
          previewTime: chart.previewTime,
          audioFileHash: chart.audioFileHash,
          backgroundFileHash: chart.backgroundFileHash,
          lengthMs: chart.lengthMs,
          columnCount: chart.columnCount,
          notes: displayNotes,
        },
        playback: {
          rate: mods.rate,
          mirror: mods.mirror,
          acronyms: mods.acronyms,
        },
        frames: decoded.frames,
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
