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
  SUNNY_ALGORITHM,
} from "./computeSunnyDan";
export { estDiff, LN_DAN_RATIO_THRESHOLD } from "./estDiff";
