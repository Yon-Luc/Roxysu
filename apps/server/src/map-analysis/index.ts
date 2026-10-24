/**
 * Mania map analysis (mania difficulty port → rework dan; pattern / timing).
 *
 * Algorithm/port sources:
 * - `packages/mania-difficulty` (pinned loleur362/osu `mania-difficulty` port)
 * - `packages/mania-pattern-analysis`
 *
 * Rework dan floors live in `packages/mania-difficulty/dans.json`.
 */
export {
  getReworkDan,
  computeReworkDanSync,
  backfillReworkDanSync,
  relabelReworkDanSync,
  ensureReworkDanForIdsSync,
  countReworkDanMissing,
  REWORK_ALGORITHM,
} from "./computeReworkDan";
export type { ReworkDanRating } from "./computeReworkDan";
export { runReworkEstimatorFromText } from "./reworkEstimator";
export type { ReworkEstimatorResult } from "./reworkEstimator";
export {
  getReworkDanJobState,
  getReworkDanJobStatus,
  getReworkDanCoverage,
  startReworkDanBackfill,
  startReworkDanRecompute,
  stopReworkDanBackfill,
  relabelReworkDan,
  countReworkDanPending,
} from "./reworkDanJob";
export {
  reworkDanLabel,
  reworkDanIntervalForStar,
  reworkDanIntervalTable,
  reworkDanTierNames,
  REWORK_LN_RATIO_THRESHOLD,
} from "./reworkDan";
export {
  getOrComputePatternAnalysis,
  getManiaPatternDetail,
  analyzeManiaPatternDetail,
  backfillPatternAnalysis,
  ensurePatternAnalysisForIdsSync,
  PATTERN_ALGORITHM,
  PATTERN_QUERY_BACKFILL_LIMIT,
} from "./computePatternAnalysis";
export type { ManiaPatternDetail } from "./computePatternAnalysis";
export {
  analyzeManiaFromOsuText,
  analyzeManiaNotes,
  analyzeManiaStructuralFromOsuText,
  analyzeManiaStructuralNotes,
  PATTERN_ALGORITHM_INTERLUDE,
  PATTERN_ALGORITHM_SKILL,
  PATTERN_ALGORITHM_V1,
  PATTERN_ALGORITHM_V2,
  PATTERN_LABELS,
  PATTERN_LABELS_INTERLUDE,
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
  getPatternAnalysisJobState,
  getPatternAnalysisJobStatus,
  getPatternAnalysisCoverage,
  startPatternAnalysisBackfill,
  startPatternAnalysisRecompute,
  stopPatternAnalysisBackfill,
  countPatternAnalysisMissing,
} from "./patternAnalysisJob";
export {
  getDanVariantJobState,
  startDanVariantJob,
  stopDanVariantJob,
} from "./danVariantJob";
export {
  collectDanVariantCombos,
  backfillDanVariantsSync,
  loadDanVariantRatingsSync,
} from "./computeDanVariants";
export type { DanVariantCombo, DanVariantRatingRow } from "./computeDanVariants";
export { getChartTimingAnalysis, loadBeatmapOsu, chartTimingFromOsuText } from "./computeTimingAnalysis";
export type { ChartTimingRating } from "./computeTimingAnalysis";
