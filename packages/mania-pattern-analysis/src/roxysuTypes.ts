/** Dominant gameplay pattern families for mania charts (Roxysu query/filter labels). */
export const PATTERN_LABELS = [
  "jack",
  "jumpstream",
  "handstream",
  "chordjack",
  "bracket",
  "chordstream",
  "stream",
  "delay",
  "mixed",
] as const;

/** Legacy v1 heuristic labels (kept for type compatibility). */
export const PATTERN_LABELS_V1 = [
  "jack",
  "jumpstream",
  "chordjack",
  "bracket",
  "chordstream",
  "stream",
  "mixed",
] as const;

/** Labels aligned with Interlude cluster mapping. */
export const PATTERN_LABELS_V2 = [
  "jack",
  "chordjack",
  "delay",
  "chordstream",
  "bracket",
  "jumpstream",
  "handstream",
  "stream",
  "mixed",
] as const;

export type PatternLabelV1 = (typeof PATTERN_LABELS_V1)[number];
export type PatternLabelV2 = (typeof PATTERN_LABELS_V2)[number];
export type PatternLabel = (typeof PATTERN_LABELS)[number];

export const PATTERN_ALGORITHM_V1 = "7k-heuristic-v1";
export const PATTERN_ALGORITHM_V2 = "7k-structural-v2";
export const PATTERN_ALGORITHM_INTERLUDE = "mania-interlude-v1";
/** Active pattern algorithm used for queries and backfill. */
export const PATTERN_ALGORITHM = PATTERN_ALGORITHM_INTERLUDE;

export type { ChartNote } from "@roxysu/osu-chart";

export type PatternMetrics = {
  columnCount: number;
  jackDensity: number;
  chordDensity: number;
  /** Stored in stream_density column (delay density for 7k-style charts). */
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
  algorithm: typeof PATTERN_ALGORITHM_INTERLUDE;
  sections: PatternSection[];
  composition: PatternComposition;
  interludeCategory: string;
};
