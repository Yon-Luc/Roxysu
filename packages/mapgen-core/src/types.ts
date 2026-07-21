import type { AudioAnalysisResult } from "@roxysu/audio-analysis";
import type { ChartNote, ManiaOsuChart } from "@roxysu/osu-chart";
import type { PatternLabelV2 } from "@roxysu/pattern-7k";
import type { DanPreset } from "./danPresets";

/** Target composition fractions (should sum to ~1; normalized if not). */
export type PatternTargets = Partial<
  Record<PatternLabelV2 | "ln", number>
>;

export type Stage2Backend = "template" | "markov";

export type MarkovTransitionModel = {
  order: number;
  transitions: Array<{
    bpmBand: string;
    starBand: string;
    history: string;
    next: Array<{ event: string; count: number }>;
  }>;
};

export type MapgenOptions = {
  columnCount?: number;
  /** Snap divisor for note placement (4 = 1/4). */
  snapDivisor?: number;
  /** Emit a note every N snap steps (1 = full density). */
  noteStride?: number;
  /** Beats per generated pattern segment. */
  segmentBeats?: number;
  /** RNG seed for reproducible output. */
  seed?: number;
  /** Override detected BPM. */
  bpm?: number;
  /** Override audio timing offset (ms). Default: audio.timingOffsetMs. */
  timingOffsetMs?: number;
  /**
   * Sunny-dan style target (`regular-4`, `LN 5`, …).
   * Applies density/LN/pattern bias when set; explicit options still win.
   */
  dan?: string;
  /**
   * When true (default) and a dan preset is set, use the preset's pattern bias
   * unless the caller passed any non-ln pattern weights.
   */
  applyDanPatternBias?: boolean;
  /**
   * When true (default) and a dan preset is set, use the preset LN unless the
   * caller explicitly passed `ln` in targets.
   */
  applyDanLn?: boolean;
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
  /** mapgen pipeline version (1 = template, 2 = Markov/corpus-aware). */
  version?: 1 | 2;
  /** Force a specific Stage 2 backend. */
  stage2Backend?: Stage2Backend;
  /** Optional transition table produced by mapgen-eval corpus extraction. */
  markovModel?: MarkovTransitionModel;
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
  timingOffsetMs: number;
  dan: DanPreset | null;
  bpmAlternates: number[];
  bpmConfidence: number;
  /** Uninherited timing points written into the chart. */
  timingPoints: Array<[number, number]>;
  stage2Backend: Stage2Backend;
  version: 1 | 2;
};
