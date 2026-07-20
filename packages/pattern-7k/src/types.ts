/** Dominant gameplay pattern families for 7k mania charts (v1 heuristic). */
export const PATTERN_LABELS_V1 = [
  "jack",
  "jumpstream",
  "chordjack",
  "bracket",
  "chordstream",
  "stream",
  "mixed",
] as const;

/** Dominant gameplay pattern families aligned with 7k wiki taxonomy (v2). */
export const PATTERN_LABELS_V2 = [
  "jack",
  "chordjack",
  "delay",
  "chordstream",
  "bracket",
  "mixed",
] as const;

export type PatternLabelV1 = (typeof PATTERN_LABELS_V1)[number];
export type PatternLabelV2 = (typeof PATTERN_LABELS_V2)[number];
export type PatternLabel = PatternLabelV1 | PatternLabelV2;

export const PATTERN_ALGORITHM_V1 = "7k-heuristic-v1";
export const PATTERN_ALGORITHM_V2 = "7k-structural-v2";
/** Active pattern algorithm used for queries and backfill. */
export const PATTERN_ALGORITHM = PATTERN_ALGORITHM_V2;

export type { ChartNote } from "@roxysu/osu-chart";

export type PatternMetrics = {
  columnCount: number;
  jackDensity: number;
  chordDensity: number;
  /** v1: stream density; v2: delay density (stored in stream_density column). */
  streamDensity: number;
  bracketDensity: number;
  chordjackScore: number;
  jumpstreamScore: number;
  chordstreamScore: number;
};

export type PatternAnalysisResult = PatternMetrics & {
  dominantPattern: PatternLabel;
  secondaryPattern: PatternLabel | null;
  confidence: number;
};

export type PatternSection = {
  startMs: number;
  endMs: number;
  patterns: Array<{ label: PatternLabelV2; coverage: number }>;
};

export type PatternComposition = Partial<Record<PatternLabelV2, number>>;

export type StructuralPatternResult = PatternAnalysisResult & {
  algorithm: typeof PATTERN_ALGORITHM_V2;
  sections: PatternSection[];
  composition: PatternComposition;
};
