import type { ManiaOsuChart, ParsedOsuChart } from "../../osu-chart/src/index";
import type { PatternAnalysisResult } from "../../pattern-7k/src/index";
import type { TimingAnalysisResult } from "../../timing-analysis/src/index";

export type ReferenceBucketKey = {
  starBand: string;
  bpmBand: string;
};

export type QuantileSummary = {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  mean: number;
};

export type MapgenFeatureSnapshot = {
  noteCount: number;
  notesPerSecond: number;
  lnRatio: number;
  bpm: number;
  dominantSnap: number;
  offSnapRatio: number;
  peakNotesPerBeat: number;
  timingPointCount: number;
  dominantPattern: string | null;
  columnUsage: number[];
  columnUsageEntropy: number;
  chordHistogram: Record<string, number>;
  chordMean: number;
  transitionEntropy: number;
  transitions: Record<string, number>;
  pattern: PatternAnalysisResult;
  timing: TimingAnalysisResult;
};

export type ReferenceBucketStats = ReferenceBucketKey & {
  sampleCount: number;
  notesPerSecond: QuantileSummary;
  lnRatio: QuantileSummary;
  dominantSnapCounts: Record<string, number>;
  offSnapRatio: QuantileSummary;
  peakNotesPerBeat: QuantileSummary;
  timingPointCount: QuantileSummary;
  columnUsageMean: number[];
  columnUsageEntropy: QuantileSummary;
  chordMean: QuantileSummary;
  transitionEntropy: QuantileSummary;
  transitionTop: Array<{ key: string; count: number }>;
  dominantPatternCounts: Record<string, number>;
};

export type ReferenceStats = {
  generatedAt: string;
  totalCharts: number;
  buckets: ReferenceBucketStats[];
};

export type EvalInput = {
  chart: ManiaOsuChart | ParsedOsuChart;
  sunnyStar?: number | null;
  explicitBpm?: number | null;
};

export type ScoredMetric = {
  value: number;
  target: QuantileSummary | null;
  verdict: "low" | "ok" | "high" | "unknown";
};

export type ScoreResult = {
  bucket: ReferenceBucketKey | null;
  snapshot: MapgenFeatureSnapshot;
  metrics: {
    notesPerSecond: ScoredMetric;
    lnRatio: ScoredMetric;
    offSnapRatio: ScoredMetric;
    peakNotesPerBeat: ScoredMetric;
    timingPointCount: ScoredMetric;
    columnUsageEntropy: ScoredMetric;
    chordMean: ScoredMetric;
    transitionEntropy: ScoredMetric;
  };
  dominantPatternMatch: boolean | null;
  dominantSnapMatch: boolean | null;
  rc: {
    illegalOverlaps: number;
    emptyColumns: number;
  };
};

export type RegressionCandidate = {
  beatmapId: string;
  title: string | null;
  artist: string | null;
  difficultyName: string | null;
  bpm: number;
  starRating: number;
  mapperUsername: string | null;
  audioFileHash: string;
  bucket: ReferenceBucketKey;
};

export type ColumnEventKind = "single" | "jump" | "hand" | "quad" | "ln";

export type ColumnTransitionContext = {
  bpmBand: string;
  starBand: string;
  history: string;
};

export type MarkovTransitionTable = {
  order: number;
  generatedAt: string;
  transitions: Array<{
    bpmBand: string;
    starBand: string;
    history: string;
    next: Array<{ event: string; count: number }>;
  }>;
};

export type CorpusChartRow = {
  beatmapId: string;
  bpm: number;
  starRating: number;
  chart: ParsedOsuChart;
};
