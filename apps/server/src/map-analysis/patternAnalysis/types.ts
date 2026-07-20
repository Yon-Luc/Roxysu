/** Dominant gameplay pattern families for 7k mania charts. */
export const PATTERN_LABELS = [
  "jack",
  "jumpstream",
  "chordjack",
  "bracket",
  "chordstream",
  "stream",
  "mixed",
] as const;

export type PatternLabel = (typeof PATTERN_LABELS)[number];

export const PATTERN_ALGORITHM = "7k-heuristic-v1";

export type ChartNote = {
  column: number;
  startMs: number;
  endMs: number;
};

export type PatternMetrics = {
  columnCount: number;
  jackDensity: number;
  chordDensity: number;
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
