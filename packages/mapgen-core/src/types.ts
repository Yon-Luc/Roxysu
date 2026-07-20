import type { AudioAnalysisResult } from "@roxysu/audio-analysis";
import type { ChartNote, ManiaOsuChart } from "@roxysu/osu-chart";
import type { PatternLabelV2 } from "@roxysu/pattern-7k";

/** Target composition fractions (should sum to ~1; normalized if not). */
export type PatternTargets = Partial<
  Record<PatternLabelV2 | "ln", number>
>;

export type MapgenOptions = {
  columnCount?: number;
  /** Snap divisor for note placement (4 = 1/4). */
  snapDivisor?: number;
  /** Beats per generated pattern segment. */
  segmentBeats?: number;
  /** RNG seed for reproducible output. */
  seed?: number;
  /** Override detected BPM. */
  bpm?: number;
  metadata?: {
    title?: string;
    artist?: string;
    creator?: string;
    version?: string;
    backgroundFilename?: string;
  };
  audioFilename?: string;
  /** Skip generating notes after this ms (default: full track). */
  endMs?: number;
};

export type MapgenResult = {
  chart: ManiaOsuChart;
  notes: ChartNote[];
  audio: AudioAnalysisResult;
  /** Pattern type chosen per segment. */
  segments: Array<{
    startMs: number;
    endMs: number;
    pattern: PatternLabelV2;
  }>;
  targets: Record<string, number>;
  bpm: number;
};
