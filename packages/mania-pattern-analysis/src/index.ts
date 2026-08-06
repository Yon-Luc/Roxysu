export * from "./types.js";
export {
  analyze,
  findAllPatterns,
  mapSpecificTypeToPatternType,
  msPerBeatToBpm,
  calculateBpmFromDelta,
  calculateBpmFromTimes,
} from "./engine.js";
export { parseOsuFile } from "./osuParser.js";
export type { ParsedOsuFile } from "./osuParser.js";
export {
  analyzeManiaFromOsuText,
  analyzeManiaNotes,
  analyzeManiaStructuralFromOsuText,
  analyzeManiaStructuralNotes,
  findAllPatternsFromOsuFile,
} from "./analyze.js";
export {
  PATTERN_ALGORITHM,
  PATTERN_ALGORITHM_INTERLUDE,
  PATTERN_ALGORITHM_V1,
  PATTERN_ALGORITHM_V2,
  PATTERN_LABELS,
  PATTERN_LABELS_V1,
  PATTERN_LABELS_V2,
} from "./roxysuTypes.js";
export type {
  ChartNote,
  PatternAnalysisResult,
  PatternComposition,
  PatternLabel,
  PatternLabelV1,
  PatternLabelV2,
  PatternMetrics,
  PatternSection,
  StructuralPatternResult,
} from "./roxysuTypes.js";

/** Backward-compatible aliases for the previous 7k-only API. */
export {
  analyzeManiaFromOsuText as analyze7kFromOsuText,
  analyzeManiaNotes as analyze7kNotes,
  analyzeManiaStructuralFromOsuText as analyze7kStructuralFromOsuText,
  analyzeManiaStructuralNotes as analyze7kStructuralNotes,
} from "./analyze.js";
