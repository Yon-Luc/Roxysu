import type { ParsedOsuChart } from "@roxysu/osu-chart";
import type { AudioAnalysisResult } from "@roxysu/audio-analysis";
import { compareNotesToBeatGrid } from "./analyzeChartTiming";
import type { TimingIssue } from "./types";

export type ChartAudioComparison = {
  audioBpm: number | null;
  audioBpmConfidence: number;
  chartBpm: number;
  /** Fraction of unique note starts far from detected beats. */
  driftRatio: number;
  issues: TimingIssue[];
};

/** Compare chart note times against detected audio beats/onsets. */
export function compareChartToAudio(
  chart: ParsedOsuChart,
  audio: AudioAnalysisResult,
  toleranceMs = 35,
): ChartAudioComparison {
  const noteTimes = [
    ...new Set(chart.notes.map((n) => n.startMs)),
  ].sort((a, b) => a - b);

  const beatTimes =
    audio.beats.length > 0
      ? audio.beats.map((b) => b.timeMs)
      : audio.onsets.map((o) => o.timeMs);

  const issues = compareNotesToBeatGrid(noteTimes, beatTimes, toleranceMs);
  const driftRatio =
    noteTimes.length > 0 ? issues.length / noteTimes.length : 0;

  const chartBpm =
    chart.timingPoints[0]?.[1] != null
      ? 60_000 / chart.timingPoints[0][1]
      : audio.bpm ?? 0;

  return {
    audioBpm: audio.bpm,
    audioBpmConfidence: audio.bpmConfidence,
    chartBpm,
    driftRatio,
    issues,
  };
}
