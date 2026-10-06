import { SKILL_LABELS, type SkillLabel, type SkillStar } from "@roxysu/mania-difficulty";

/**
 * Dominant gameplay skill for a mania chart (Roxysu query/filter labels).
 * Replaces the retired Interlude pattern families (jack / jumpstream / …).
 */
export const PATTERN_LABELS = SKILL_LABELS;

export type PatternLabel = SkillLabel;

/** Retired Interlude labels, kept for reading legacy stored rows. */
export const PATTERN_LABELS_INTERLUDE = [
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

/** Retired 7k heuristic labels (kept for type compatibility). */
export const PATTERN_LABELS_V1 = [
  "jack",
  "jumpstream",
  "chordjack",
  "bracket",
  "chordstream",
  "stream",
  "mixed",
] as const;

export type PatternLabelV1 = (typeof PATTERN_LABELS_V1)[number];
export type PatternLabelV2 = SkillLabel;

export const PATTERN_ALGORITHM_V1 = "7k-heuristic-v1";
export const PATTERN_ALGORITHM_V2 = "7k-structural-v2";
/** Retired Interlude/YAVSRG pattern algorithm. */
export const PATTERN_ALGORITHM_INTERLUDE = "mania-interlude-v1";
/** Active pattern algorithm: dominant skill from the mania difficulty port. */
export const PATTERN_ALGORITHM_SKILL = "mania-skill-v1";
/** Active pattern algorithm used for queries and backfill. */
export const PATTERN_ALGORITHM = PATTERN_ALGORITHM_SKILL;

export type { ChartNote } from "@roxysu/osu-chart";
export type { SkillStar };

export type PatternMetrics = {
  columnCount: number;
  jackDensity: number;
  chordDensity: number;
  /** Stored in stream_density column. */
  streamDensity: number;
  bracketDensity: number;
  chordjackScore: number;
  jumpstreamScore: number;
  chordstreamScore: number;
};

export type PatternAnalysisResult = PatternMetrics & {
  dominantPattern: PatternLabel | null;
  secondaryPattern: PatternLabel | null;
  confidence: number;
};

export type PatternSection = {
  startMs: number;
  endMs: number;
  patterns: Array<{ label: PatternLabel; coverage: number }>;
};

export type PatternComposition = Partial<Record<PatternLabel, number>> & {
  total?: number;
};

export type StructuralPatternResult = PatternAnalysisResult & {
  algorithm: typeof PATTERN_ALGORITHM;
  sections: PatternSection[];
  composition: PatternComposition;
  /** Every skill's star rating, highest first. */
  skillStars: SkillStar[];
  /** Chart star rating the skills came from. */
  starRating: number;
};