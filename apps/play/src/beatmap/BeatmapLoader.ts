import type { AssetResolver } from "../assets/AssetResolver";
import type { BeatmapSummary } from "../database/types";
import type { BeatmapChart } from "./BeatmapChart";
import {
  parseBeatmapGeneral,
  type BeatmapGeneralSettings,
} from "./BeatmapMetadata";
import { parseBeatmapChart, type BeatmapParseError } from "./BeatmapParser";
import { toPlayfieldChart } from "../playfield/PlayfieldChart";
import type { PlayfieldChart } from "../playfield/PlayfieldTypes";

export type LoadedBeatmap = {
  summary: BeatmapSummary;
  chart: BeatmapChart;
  playfield: PlayfieldChart;
  audioPath: string | null;
  general: BeatmapGeneralSettings;
};

export type BeatmapPreviewInfo = {
  audioPath: string | null;
  previewTimeMs: number | null;
};

export type BeatmapLoadError =
  | { kind: "missing_hash"; message: string }
  | { kind: "missing_beatmap_blob"; message: string }
  | { kind: "missing_audio_blob"; message: string }
  | BeatmapParseError;

async function readBeatmapOsuText(
  summary: BeatmapSummary,
  assets: AssetResolver,
): Promise<{ osuText: string } | BeatmapLoadError> {
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
  return { osuText };
}

function resolveAudioPath(
  summary: BeatmapSummary,
  assets: AssetResolver,
): string | null {
  if (!summary.audioFileHash) return null;
  const audioAsset = assets.resolveAudio(summary.audioFileHash);
  return audioAsset.status === "available" ? audioAsset.path : null;
}

export async function loadBeatmapPreview(
  summary: BeatmapSummary,
  assets: AssetResolver,
): Promise<BeatmapPreviewInfo | BeatmapLoadError> {
  const osu = await readBeatmapOsuText(summary, assets);
  if ("kind" in osu) {
    return osu;
  }

  const general = parseBeatmapGeneral(osu.osuText);
  return {
    audioPath: resolveAudioPath(summary, assets),
    previewTimeMs: general.previewTimeMs,
  };
}

export async function loadBeatmapForPlay(
  summary: BeatmapSummary,
  assets: AssetResolver,
): Promise<LoadedBeatmap | BeatmapLoadError> {
  const osu = await readBeatmapOsuText(summary, assets);
  if ("kind" in osu) {
    return osu;
  }

  const general = parseBeatmapGeneral(osu.osuText);
  const parsed = parseBeatmapChart(
    osu.osuText,
    summary.overallDifficulty ?? 8,
  );
  if ("kind" in parsed) {
    return parsed;
  }

  return {
    summary,
    chart: parsed,
    playfield: toPlayfieldChart(parsed),
    audioPath: resolveAudioPath(summary, assets),
    general,
  };
}
