import type { AssetResolver } from "../assets/AssetResolver";
import type { BeatmapSummary } from "../database/types";
import type { BeatmapChart } from "./BeatmapChart";
import { parseBeatmapChart, type BeatmapParseError } from "./BeatmapParser";
import { toPlayfieldChart } from "../playfield/PlayfieldChart";
import type { PlayfieldChart } from "../playfield/PlayfieldTypes";

export type LoadedBeatmap = {
  summary: BeatmapSummary;
  chart: BeatmapChart;
  playfield: PlayfieldChart;
  audioPath: string | null;
};

export type BeatmapLoadError =
  | { kind: "missing_hash"; message: string }
  | { kind: "missing_beatmap_blob"; message: string }
  | { kind: "missing_audio_blob"; message: string }
  | BeatmapParseError;

export async function loadBeatmapForPlay(
  summary: BeatmapSummary,
  assets: AssetResolver,
): Promise<LoadedBeatmap | BeatmapLoadError> {
  if (!summary.hash) {
    return {
      kind: "missing_hash",
      message: "Beatmap is missing a content hash",
    };
  }

  const beatmapAsset = assets.resolveBeatmap(summary.hash);
  if (beatmapAsset.status !== "available") {
    return {
      kind: "missing_beatmap_blob",
      message: "Beatmap file is not available in osu!lazer files/",
    };
  }

  const osuText = await Bun.file(beatmapAsset.path).text();
  const parsed = parseBeatmapChart(
    osuText,
    summary.overallDifficulty ?? 8,
  );
  if ("kind" in parsed) {
    return parsed;
  }

  let audioPath: string | null = null;
  if (summary.audioFileHash) {
    const audioAsset = assets.resolveAudio(summary.audioFileHash);
    if (audioAsset.status === "available") {
      audioPath = audioAsset.path;
    }
  }

  return {
    summary,
    chart: parsed,
    playfield: toPlayfieldChart(parsed),
    audioPath,
  };
}
