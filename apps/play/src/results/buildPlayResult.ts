import type { BeatmapSummary } from "../database/types";
import type { GameplaySnapshot } from "../gameplay/GameplayEngine";
import type { PlayResult } from "./PlayResult";

export function buildPlayResult(
  beatmap: BeatmapSummary,
  gameplay: GameplaySnapshot,
): PlayResult {
  return {
    chartId: beatmap.id,
    title: beatmap.title ?? "Unknown title",
    artist: beatmap.artist ?? "Unknown artist",
    difficultyName: beatmap.difficultyName ?? "?",
    score: gameplay.score,
    accuracy: gameplay.accuracy,
    maxCombo: gameplay.maxCombo,
    counts: { ...gameplay.counts },
  };
}
