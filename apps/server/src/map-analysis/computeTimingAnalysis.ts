import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { beatmaps, type Db } from "@roxysu/db/client.bun";
import { parseOsuChart } from "@roxysu/osu-chart";
import { analyzeAudioFile } from "@roxysu/audio-analysis";
import {
  analyzeChartTiming,
  compareChartToAudio,
  type TimingIssue,
  type TimingIssueKind,
} from "@roxysu/timing-analysis";
import {
  ffmpegUnavailableMessage,
  isFfmpegAvailableAt,
  resolveFfmpegPath,
} from "../shared/ffmpeg-path";
import {
  getOsuDataPath,
  lazerFileExists,
  resolveLazerFilePath,
} from "../shared/lazer-files";

const MAX_ISSUES = 40;

export type ChartTimingRating = {
  algorithm: string;
  metrics: {
    bpm: number;
    dominantSnap: number;
    snapCoverage: number;
    offSnapRatio: number;
    peakNotesPerBeat: number;
    timingPointCount: number;
  };
  issues: TimingIssue[];
  issueCounts: Partial<Record<TimingIssueKind, number>>;
  error: string | null;
};

export type MusicDriftRating = {
  audioBpm: number | null;
  audioBpmConfidence: number;
  chartBpm: number;
  driftRatio: number;
  issues: TimingIssue[];
  error: string | null;
};

function countIssues(issues: TimingIssue[]): Partial<Record<TimingIssueKind, number>> {
  const counts: Partial<Record<TimingIssueKind, number>> = {};
  for (const issue of issues) {
    counts[issue.kind] = (counts[issue.kind] ?? 0) + 1;
  }
  return counts;
}

function prioritizeIssues(issues: TimingIssue[]): TimingIssue[] {
  const rank = { error: 0, warn: 1, info: 2 } as const;
  return [...issues]
    .sort((a, b) => {
      const sev = rank[a.severity] - rank[b.severity];
      return sev !== 0 ? sev : a.startMs - b.startMs;
    })
    .slice(0, MAX_ISSUES);
}

async function loadBeatmapOsu(
  db: Db,
  beatmapId: string,
): Promise<
  | { ok: true; osuText: string; beatmap: typeof beatmaps.$inferSelect }
  | { ok: false; error: string }
> {
  const [beatmap] = await db
    .select()
    .from(beatmaps)
    .where(eq(beatmaps.id, beatmapId))
    .limit(1);

  if (!beatmap) return { ok: false, error: "Beatmap not found" };
  if (beatmap.rulesetShortName !== "mania") {
    return { ok: false, error: "Timing analysis is mania-only" };
  }
  if (!beatmap.hash) return { ok: false, error: "Beatmap hash missing" };

  const filePath = resolveLazerFilePath(beatmap.hash, getOsuDataPath());
  if (!filePath) return { ok: false, error: "Could not resolve lazer file path" };

  try {
    const osuText = readFileSync(filePath, "utf8");
    return { ok: true, osuText, beatmap };
  } catch {
    return { ok: false, error: "Beatmap file not found in lazer files store" };
  }
}

/** Analyze snap/BPM consistency from the on-disk `.osu` file. */
export async function getChartTimingAnalysis(
  db: Db,
  beatmapId: string,
): Promise<ChartTimingRating | null> {
  const loaded = await loadBeatmapOsu(db, beatmapId);
  if (!loaded.ok) {
    return {
      algorithm: "timing-v1",
      metrics: {
        bpm: 0,
        dominantSnap: 4,
        snapCoverage: 0,
        offSnapRatio: 0,
        peakNotesPerBeat: 0,
        timingPointCount: 0,
      },
      issues: [],
      issueCounts: {},
      error: loaded.error,
    };
  }

  try {
    const chart = parseOsuChart(loaded.osuText);
    const result = analyzeChartTiming(chart);
    return {
      algorithm: result.algorithm,
      metrics: result.metrics,
      issues: prioritizeIssues(result.issues),
      issueCounts: countIssues(result.issues),
      error: null,
    };
  } catch (err) {
    return {
      algorithm: "timing-v1",
      metrics: {
        bpm: 0,
        dominantSnap: 4,
        snapCoverage: 0,
        offSnapRatio: 0,
        peakNotesPerBeat: 0,
        timingPointCount: 0,
      },
      issues: [],
      issueCounts: {},
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Decode chart audio via ffmpeg and compare note times to detected beats. */
export async function analyzeMusicDrift(
  db: Db,
  beatmapId: string,
): Promise<MusicDriftRating | null> {
  const loaded = await loadBeatmapOsu(db, beatmapId);
  if (!loaded.ok) {
    return {
      audioBpm: null,
      audioBpmConfidence: 0,
      chartBpm: 0,
      driftRatio: 0,
      issues: [],
      error: loaded.error,
    };
  }

  const { beatmap, osuText } = loaded;
  if (!beatmap.audioFileHash) {
    return {
      audioBpm: null,
      audioBpmConfidence: 0,
      chartBpm: 0,
      driftRatio: 0,
      issues: [],
      error: "Beatmap audio hash missing",
    };
  }

  const ffmpegPath = resolveFfmpegPath();
  if (!(await isFfmpegAvailableAt(ffmpegPath))) {
    return {
      audioBpm: null,
      audioBpmConfidence: 0,
      chartBpm: 0,
      driftRatio: 0,
      issues: [],
      error: ffmpegUnavailableMessage(ffmpegPath),
    };
  }

  if (!lazerFileExists(beatmap.audioFileHash, getOsuDataPath())) {
    return {
      audioBpm: null,
      audioBpmConfidence: 0,
      chartBpm: 0,
      driftRatio: 0,
      issues: [],
      error: "Audio file not found in lazer files store",
    };
  }

  const audioPath = resolveLazerFilePath(beatmap.audioFileHash, getOsuDataPath());
  if (!audioPath) {
    return {
      audioBpm: null,
      audioBpmConfidence: 0,
      chartBpm: 0,
      driftRatio: 0,
      issues: [],
      error: "Could not resolve audio file path",
    };
  }

  try {
    const chart = parseOsuChart(osuText);
    const audio = await analyzeAudioFile(audioPath, { ffmpegPath });
    const comparison = compareChartToAudio(chart, audio);

    return {
      audioBpm: comparison.audioBpm,
      audioBpmConfidence: comparison.audioBpmConfidence,
      chartBpm: comparison.chartBpm,
      driftRatio: comparison.driftRatio,
      issues: prioritizeIssues(comparison.issues),
      error: null,
    };
  } catch (err) {
    return {
      audioBpm: null,
      audioBpmConfidence: 0,
      chartBpm: 0,
      driftRatio: 0,
      issues: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
