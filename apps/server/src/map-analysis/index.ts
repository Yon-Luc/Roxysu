/**
 * Mania map analysis (Sunny Rework → dan estimate).
 *
 * Algorithm/port sources:
 * - https://github.com/LeoBlackMT/osumania_map_analyser (Sunny + dan interval tables)
 * - https://github.com/sunnyxxy/Star-Rating-Rebirth (Sunny Rework)
 */
export { runSunnyEstimatorFromText } from "./sunnyEstimator";
export {
  getOrComputeSunnyDan,
  backfillSunnyDanSync,
  relabelSunnyDanSync,
  ensureSunnyDanForIdsSync,
  SUNNY_ALGORITHM,
} from "./computeSunnyDan";
export { estDiff, LN_DAN_RATIO_THRESHOLD } from "./estDiff";
export {
  getOrComputePatternAnalysis,
  backfillPatternAnalysisSync,
  ensurePatternAnalysisForIdsSync,
  PATTERN_ALGORITHM,
  PATTERN_QUERY_BACKFILL_LIMIT,
} from "./computePatternAnalysis";
export { analyze7kFromOsuText, analyze7kNotes } from "@roxysu/pattern-7k";
export {
  analyze7kStructuralFromOsuText,
  analyze7kStructuralNotes,
  PATTERN_ALGORITHM_V1,
  PATTERN_ALGORITHM_V2,
  PATTERN_LABELS,
} from "@roxysu/pattern-7k";
export type { PatternLabel } from "@roxysu/pattern-7k";
export {
  getSunnyDanJobState,
  getSunnyDanCoverage,
  startSunnyDanBackfill,
  stopSunnyDanBackfill,
  countSunnyDanMissing,
} from "./sunnyDanJob";
export {
  getPatternAnalysisJobState,
  getPatternAnalysisCoverage,
  startPatternAnalysisBackfill,
  stopPatternAnalysisBackfill,
  countPatternAnalysisMissing,
} from "./patternAnalysisJob";
export { getChartTimingAnalysis } from "./computeTimingAnalysis";
export type { ChartTimingRating } from "./computeTimingAnalysis";
