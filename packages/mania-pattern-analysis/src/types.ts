/**
 * Core data types for the pattern analysis library.
 * Ported from Companella (Leinadix/companella), which itself ports the
 * YAVSRG / Interlude "Prelude" pattern-detection algorithm (Patterns.fs).
 */

export type HitObjectType = "Circle" | "Hold";

/** A single note (or hold) in a mania chart. */
export interface HitObject {
  /** Time in milliseconds. */
  time: number;
  /** 0-based column index. */
  column: number;
  type: HitObjectType;
  /** End time for holds (equal to `time` for circles). */
  endTime: number;
}

/** Core pattern categories used by the recogniser engine. */
export type CorePattern = "Stream" | "Chordstream" | "Jacks";

export type Direction = "None" | "Left" | "Right" | "Outwards" | "Inwards";

/** Per-row chart data used by the recognisers (one row = one unique note time). */
export interface RowInfo {
  index: number;
  /** Time relative to the first note, in ms. */
  time: number;
  /** ms per beat, assuming 1/4 spacing between this row and the previous one. */
  msPerBeat: number;
  /** Number of distinct columns hit in this row. */
  notes: number;
  /** Number of columns that overlap with the previous row (i.e. jacks). */
  jacks: number;
  direction: Direction;
  /** True if the row "rolled through" the previous row's column range. */
  roll: boolean;
  density: number;
  rawNotes: number[];
}

/** A single detected pattern instance before clustering. */
export interface FoundPattern {
  pattern: CorePattern;
  specificType: string | null;
  mixed: boolean;
  start: number;
  end: number;
  msPerBeat: number;
  density: number;
}

/** A clustered pattern summary for display. */
export interface PatternCluster {
  pattern: CorePattern;
  displayName: string;
  specificTypes: Array<[name: string, fraction: number]>;
  bpm: number;
  mixed: boolean;
  amountMs: number;
  importance: number;
}

export function formatClusterLabel(cluster: PatternCluster, rate = 1.0): string {
  const bpm = Math.round(cluster.bpm * rate);
  return cluster.mixed ? `~${bpm} Mixed ${cluster.displayName}` : `${bpm} ${cluster.displayName}`;
}

/** Full Interlude-style pattern report for a chart. */
export interface InterludePatternReport {
  foundPatterns: FoundPattern[];
  clusters: PatternCluster[];
  category: string;
  durationMs: number;
  firstNoteTimeMs: number;
  totalRows: number;
}

export type PatternRecogniser = (rows: RowInfo[]) => number;

export interface SpecificPatterns {
  stream: Array<[name: string, recogniser: PatternRecogniser]>;
  chordstream: Array<[name: string, recogniser: PatternRecogniser]>;
  jack: Array<[name: string, recogniser: PatternRecogniser]>;
}

/** High-level pattern type, mapped from Interlude's specific/core pattern names. */
export type PatternType =
  | "Trill"
  | "Jack"
  | "Minijack"
  | "Stream"
  | "Jump"
  | "Hand"
  | "Quad"
  | "Jumpstream"
  | "Handstream"
  | "Chordjack"
  | "Roll"
  | "Bracket"
  | "Jumptrill";

/** A single detected pattern instance, mapped to the simplified PatternType space. */
export interface Pattern {
  type: PatternType;
  startTime: number;
  endTime: number;
  bpm: number;
  noteCount: number;
  specificName: string | null;
  mixed: boolean;
  corePattern: string;
}

export interface PatternAnalysisResult {
  success: boolean;
  errorMessage?: string;
  totalNotes: number;
  analysisDurationMs: number;
  /** Patterns grouped by their simplified PatternType. */
  patterns: Partial<Record<PatternType, Pattern[]>>;
  interludeClusters: PatternCluster[];
  interludeCategory: string;
  chartDurationMs: number;
  chartFirstNoteTimeMs: number;
}
