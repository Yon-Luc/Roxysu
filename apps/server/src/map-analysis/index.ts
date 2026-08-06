/**
 * Mania map analysis (Sunny Rework → dan estimate; Daniel for 4K RC).
 *
 * Algorithm/port sources:
 * - https://github.com/LeoBlackMT/osumania_map_analyser (Sunny/Daniel + dan interval tables)
 * - https://github.com/sunnyxxy/Star-Rating-Rebirth (Sunny Rework)
 * - https://thebagelofman.github.io/Daniel/ (Daniel 4K RC estimator)
 */
export { runSunnyEstimatorFromText } from "./sunnyEstimator";
export { runDanielEstimatorFromText } from "./danielEstimator";
export {
  getOrComputeSunnyDan,
  backfillSunnyDanSync,
  relabelSunnyDanSync,
  ensureSunnyDanForIdsSync,
  SUNNY_ALGORITHM,
} from "./computeSunnyDan";
export {
  getOrComputeDanielDan,
  backfillDanielDanSync,
  ensureDanielDanForIdsSync,
  DANIEL_ALGORITHM,
} from "./computeDanielDan";
export { estDiff, LN_DAN_RATIO_THRESHOLD } from "./estDiff";
export {
  getOrComputePatternAnalysis,
  backfillPatternAnalysisSync,
  ensurePatternAnalysisForIdsSync,
  PATTERN_ALGORITHM,
  PATTERN_QUERY_BACKFILL_LIMIT,
} from "./computePatternAnalysis";
export {
  analyzeManiaFromOsuText,
  analyzeManiaNotes,
  analyzeManiaStructuralFromOsuText,
  analyzeManiaStructuralNotes,
  PATTERN_ALGORITHM_INTERLUDE,
  PATTERN_ALGORITHM_V1,
  PATTERN_ALGORITHM_V2,
  PATTERN_LABELS,
} from "@roxysu/mania-pattern-analysis";
export type { PatternLabel } from "@roxysu/mania-pattern-analysis";
/** @deprecated Use analyzeManiaFromOsuText */
export { analyzeManiaFromOsuText as analyze7kFromOsuText } from "@roxysu/mania-pattern-analysis";
/** @deprecated Use analyzeManiaNotes */
export { analyzeManiaNotes as analyze7kNotes } from "@roxysu/mania-pattern-analysis";
/** @deprecated Use analyzeManiaStructuralFromOsuText */
export { analyzeManiaStructuralFromOsuText as analyze7kStructuralFromOsuText } from "@roxysu/mania-pattern-analysis";
/** @deprecated Use analyzeManiaStructuralNotes */
export { analyzeManiaStructuralNotes as analyze7kStructuralNotes } from "@roxysu/mania-pattern-analysis";
export {
  getSunnyDanJobState,
  getSunnyDanCoverage,
  startSunnyDanBackfill,
  stopSunnyDanBackfill,
  countSunnyDanMissing,
} from "./sunnyDanJob";
export {
  getDanielDanJobState,
  getDanielDanCoverage,
  startDanielDanBackfill,
  stopDanielDanBackfill,
  countDanielDanMissing,
} from "./danielDanJob";
export {
  getPatternAnalysisJobState,
  getPatternAnalysisCoverage,
  startPatternAnalysisBackfill,
  startPatternAnalysisRecompute,
  stopPatternAnalysisBackfill,
  countPatternAnalysisMissing,
} from "./patternAnalysisJob";
export { getChartTimingAnalysis } from "./computeTimingAnalysis";
export type { ChartTimingRating } from "./computeTimingAnalysis";
